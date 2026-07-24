use std::time::Instant;

use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, StatusCode},
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

/// C3 hot-path preamble: resolve the caller's budget node and hard-reserve a
/// worst-case estimate BEFORE inference. **Fail-closed** — a token with no tenant,
/// a caller with no resolvable node, or an over-cap `hard` node is denied (402).
/// Returns `(tenant, node, hold)` for the commit/release at the end of the call.
async fn reserve_budget(
    state: &SharedState,
    claims: &Claims,
    max_tokens: u32,
    idem: Option<&str>,
) -> Result<(Uuid, Uuid, Uuid), (StatusCode, String)> {
    let tenant = claims.tenant_id.ok_or((
        StatusCode::PAYMENT_REQUIRED,
        "budgeted access required: token carries no tenant".to_string(),
    ))?;
    let subject = Uuid::parse_str(&claims.sub)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid subject in token".to_string()))?;

    let node = crate::budgets::resolve_node(&state.pool, tenant, subject)
        .await
        .map_err(|e| match e {
            crate::budgets::BudgetError::NoNode => (
                StatusCode::PAYMENT_REQUIRED,
                "no budget node for caller — access denied".to_string(),
            ),
            crate::budgets::BudgetError::Db(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            crate::budgets::BudgetError::Exceeded => {
                (StatusCode::INTERNAL_SERVER_ERROR, "budget error".to_string())
            }
        })?;

    let est = crate::budgets::estimate(max_tokens);
    let hold = crate::budgets::reserve(&state.pool, tenant, node, est, idem)
        .await
        .map_err(|e| match e {
            crate::budgets::BudgetError::Exceeded => (
                StatusCode::PAYMENT_REQUIRED,
                // structured so a client can POST /rpc/budgets/request with the node.
                serde_json::json!({
                    "error": "budget exceeded — hard cap reached",
                    "code": "budget_exceeded",
                    "budget_node_id": node
                })
                .to_string(),
            ),
            crate::budgets::BudgetError::Db(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            crate::budgets::BudgetError::NoNode => {
                (StatusCode::INTERNAL_SERVER_ERROR, "budget error".to_string())
            }
        })?;

    Ok((tenant, node, hold))
}

// ---------------------------------------------------------------------------
// POST /v1/chat
// ---------------------------------------------------------------------------

pub async fn post_chat(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    let ireq = build_inference_request(&req);
    let max_tokens = req.max_tokens.unwrap_or(1024);
    // Optional client idempotency: same key ⇒ budget_reserve returns the same hold
    // (no double-reserve on a retry).
    let idem = headers.get("idempotency-key").and_then(|v| v.to_str().ok());

    // C3: resolve the caller's budget node + hard reserve BEFORE inference (fail-closed).
    let (tenant, node, hold) = reserve_budget(&state, &claims, max_tokens, idem).await?;

    let start = Instant::now();
    let exec = state.gateway.execute(&ireq).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    let resp = match exec {
        Ok(r) => r,
        Err(e) => {
            // inference failed — release the hold so no headroom is consumed.
            let _ = crate::budgets::release(&state.pool, tenant, hold).await;
            return Err((StatusCode::BAD_GATEWAY, e.to_string()));
        }
    };

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

    // C3: commit the actual spend against the reserved hold (releases the surplus).
    if let Err(e) = crate::budgets::commit(&state.pool, tenant, hold, cost_usd).await {
        tracing::warn!("chat: budget commit failed (spend not recorded on node): {}", e);
    }

    let chat_response = ChatResponse {
        content,
        model: model.clone(),
        cost_usd,
        input_tokens,
        output_tokens,
    };

    // --- Persist (best-effort) — tenant is known (reserve_budget errored otherwise) ---
    {
        let successful_attempt = resp.attempts.last();
        let adapter = successful_attempt
            .map(|a| a.adapter.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let api_model_id = successful_attempt.map(|a| a.api_model_id.clone());

        let call = InferenceCall {
            id: Uuid::new_v4(),
            session_id: None,
            project_id: None,
            subject_id: Some(node), // C3: metered against the resolved budget node
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
            tenant_id: tenant,
        };

        if let Err(e) = store.insert_inference_call(&call).await {
            tracing::warn!("chat: persist inference_call failed (best-effort): {}", e);
        }
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
    headers: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> Response {
    let ireq = build_inference_request(&req);
    let max_tokens = req.max_tokens.unwrap_or(1024);
    let idem = headers.get("idempotency-key").and_then(|v| v.to_str().ok());

    // C3: resolve budget node + hard reserve BEFORE streaming (fail-closed). A denied
    // caller gets a synchronous JSON error — the stream is never opened (no bypass).
    let (tenant, node, hold) = match reserve_budget(&state, &claims, max_tokens, idem).await {
        Ok(v) => v,
        Err((code, msg)) => {
            return Response::builder()
                .status(code)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::json!({ "error": msg }).to_string()))
                .unwrap_or_else(|_| {
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Body::empty())
                        .unwrap()
                });
        }
    };

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

                // C3: commit the actual spend against the reserved hold.
                if let Err(e) = crate::budgets::commit(&state.pool, tenant, hold, cost_usd).await {
                    tracing::warn!("chat/stream: budget commit failed: {}", e);
                }

                // Best-effort persist (mirror of post_chat) — tenant known via reserve.
                {
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
                        subject_id: Some(node), // C3: metered against the resolved budget node
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

                    let store = PgGatewayStore { pool: state.pool.clone(), tenant_id: tenant };
                    if let Err(e) = store.insert_inference_call(&call).await {
                        tracing::warn!("chat/stream: persist failed (best-effort): {}", e);
                    }
                }
            }
            Err(e) => {
                // inference failed — release the hold (no spend).
                let _ = crate::budgets::release(&state.pool, tenant, hold).await;
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
