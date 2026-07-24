use std::time::Instant;

use axum::{
    body::Body,
    extract::State,
    http::{header, StatusCode},
    response::Response,
    Extension, Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use gateway::{
    store::{CallStatus, GatewayStore, InferenceCall},
    types::{
        capability::Capability,
        request::{InferenceRequest, Message, MessageRole, Payload},
    },
};

use crate::{auth::Claims, state::SharedState, store::PgGatewayStore};

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub chain: Option<String>,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: Option<String>,
    pub cost_usd: f64,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn map_role(role: &str) -> MessageRole {
    match role {
        "assistant" => MessageRole::Assistant,
        "system" => MessageRole::System,
        "tool" => MessageRole::Tool,
        _ => MessageRole::User,
    }
}

fn build_inference_request(req: &ChatRequest) -> InferenceRequest {
    // C4 §2 W5 — redact-in-flight: strip secrets/PII from every message and the
    // system prompt BEFORE they egress to any model (cloud especially). One-way
    // placeholders (v1). Redaction counts flow into the governance/quality signal.
    let redactor = crate::redact::Redactor;
    let messages: Vec<Message> = req
        .messages
        .iter()
        .map(|m| {
            let (clean, _) = redactor.redact(&m.content);
            Message::text(map_role(&m.role), &clean)
        })
        .collect();
    let system = req
        .system
        .as_ref()
        .map(|s| redactor.redact(s).0);

    InferenceRequest {
        capability: Capability::TextChat,
        model: req.model.clone(),
        router: None,
        chain: req.chain.clone(),
        payload: Payload::Chat {
            messages,
            system,
            max_tokens: req.max_tokens.or(Some(1024)),
            temperature: None,
            tools: Vec::new(),
        },
        budget: None,
        // MIG-2 (v0.4.6): AUTH context + panel/consensus addressing. None ⇒ no
        // crate-side quota (budgets enforced by C3), no panel/consensus fan-out.
        auth: None,
        panel: None,
        consensus: None,
    }
}

// ---------------------------------------------------------------------------
// POST /v1/chat
// ---------------------------------------------------------------------------

pub async fn post_chat(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    let ireq = build_inference_request(&req);

    let start = Instant::now();
    let resp = state
        .gateway
        .execute(&ireq)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let duration_ms = start.elapsed().as_millis() as u64;

    // --- Map response ---
    let content = resp.content.clone().unwrap_or_default();
    let model = resp.model.clone();
    let cost_usd = resp
        .actual_cost
        .as_ref()
        .map(|c| c.total_cost)
        .or_else(|| resp.estimated_cost.as_ref().map(|e| e.estimated))
        .unwrap_or(0.0);
    let input_tokens = resp.usage.as_ref().map(|u| u.input_tokens);
    let output_tokens = resp.usage.as_ref().map(|u| u.output_tokens);

    let chat_response = ChatResponse {
        content,
        model: model.clone(),
        cost_usd,
        input_tokens,
        output_tokens,
    };

    // --- Persist (best-effort) ---
    if let Some(tid) = claims.tenant_id {
        let successful_attempt = resp.attempts.last();
        let adapter = successful_attempt
            .map(|a| a.adapter.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let api_model_id = successful_attempt.map(|a| a.api_model_id.clone());

        let call = InferenceCall {
            id: Uuid::new_v4(),
            session_id: None,
            project_id: None,
            subject_id: None, // MIG-2: budget/quota attribution — set by C3 in the rework
            tier: None,
            capability: Capability::TextChat,
            chain_id: req.chain.clone(),
            adapter,
            model: model.unwrap_or_default(),
            api_model_id,
            input_tokens,
            output_tokens,
            cost_usd,
            duration_ms,
            status: if resp.success {
                CallStatus::Success
            } else {
                CallStatus::Failed
            },
            error_type: None,
            fallback_sequence: resp.attempts.len() as u8,
            recorded_at: Utc::now(),
        };

        let store = PgGatewayStore {
            pool: state.pool.clone(),
            tenant_id: tid,
        };

        if let Err(e) = store.insert_inference_call(&call).await {
            tracing::warn!("chat: persist inference_call failed (best-effort): {}", e);
        }
    } else {
        tracing::debug!("chat: no tenant_id in claims — skipping persist");
    }

    Ok(Json(chat_response))
}

// ---------------------------------------------------------------------------
// POST /v1/chat/stream  (SSE, best-effort)
// ---------------------------------------------------------------------------

/// SSE data line: `data: <json>\n\n`
fn sse_data(payload: &serde_json::Value) -> Vec<u8> {
    format!("data: {}\n\n", payload).into_bytes()
}

/// SSE error event followed by a done sentinel so the client can close.
fn sse_error(msg: &str) -> Vec<u8> {
    let v = serde_json::json!({ "error": msg });
    format!("event: error\ndata: {}\n\n", v).into_bytes()
}

pub async fn post_chat_stream(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(req): Json<ChatRequest>,
) -> Response {
    let ireq = build_inference_request(&req);

    // Channel that carries SSE-formatted lines as raw bytes.
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, std::convert::Infallible>>(32);

    tokio::spawn(async move {
        let start = Instant::now();
        match state.gateway.execute(&ireq).await {
            Ok(resp) => {
                // Emit the content chunk
                let chunk = serde_json::json!({
                    "content": resp.content.clone().unwrap_or_default(),
                    "model": resp.model.clone(),
                    "done": false,
                });
                let _ = tx.send(Ok(sse_data(&chunk))).await;

                let cost_usd = resp
                    .actual_cost
                    .as_ref()
                    .map(|c| c.total_cost)
                    .or_else(|| resp.estimated_cost.as_ref().map(|e| e.estimated))
                    .unwrap_or(0.0);

                // Emit done event with metadata
                let done_chunk = serde_json::json!({
                    "done": true,
                    "model": resp.model.clone(),
                    "cost_usd": cost_usd,
                    "input_tokens": resp.usage.as_ref().map(|u| u.input_tokens),
                    "output_tokens": resp.usage.as_ref().map(|u| u.output_tokens),
                });
                let _ = tx.send(Ok(sse_data(&done_chunk))).await;

                // Best-effort persist (mirror of post_chat)
                if let Some(tid) = claims.tenant_id {
                    let duration_ms = start.elapsed().as_millis() as u64;
                    let successful_attempt = resp.attempts.last();
                    let adapter = successful_attempt
                        .map(|a| a.adapter.clone())
                        .unwrap_or_else(|| "unknown".to_string());
                    let api_model_id = successful_attempt.map(|a| a.api_model_id.clone());

                    let call = InferenceCall {
                        id: Uuid::new_v4(),
                        session_id: None,
                        project_id: None,
                        subject_id: None, // MIG-2: budget/quota attribution — set by C3 in the rework
                        tier: None,
                        capability: Capability::TextChat,
                        chain_id: req.chain.clone(),
                        adapter,
                        model: resp.model.unwrap_or_default(),
                        api_model_id,
                        input_tokens: resp.usage.as_ref().map(|u| u.input_tokens),
                        output_tokens: resp.usage.as_ref().map(|u| u.output_tokens),
                        cost_usd,
                        duration_ms,
                        status: CallStatus::Success,
                        error_type: None,
                        fallback_sequence: resp.attempts.len() as u8,
                        recorded_at: Utc::now(),
                    };

                    let store = PgGatewayStore { pool: state.pool.clone(), tenant_id: tid };
                    if let Err(e) = store.insert_inference_call(&call).await {
                        tracing::warn!("chat/stream: persist failed (best-effort): {}", e);
                    }
                }
            }
            Err(e) => {
                tracing::error!("chat/stream: gateway execute error: {}", e);
                let _ = tx.send(Ok(sse_error(&e.to_string()))).await;
            }
        }
    });

    let stream = ReceiverStream::new(rx);

    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("Connection", "keep-alive")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .unwrap()
        })
}
