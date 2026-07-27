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

/// Rough INPUT-token estimate for the worst-case pre-call reserve (~4 chars/token, a
/// standard heuristic) over every message plus the system prompt. Only needs to be a
/// sane upper-bound input to `budgets::estimate` so a large prompt paired with a tiny
/// `max_tokens` still reserves proportionally — over-reserve is released at commit.
fn estimate_input_tokens(req: &ChatRequest) -> u32 {
    let chars: usize = req
        .messages
        .iter()
        .map(|m| m.content.chars().count())
        .sum::<usize>()
        + req
            .system
            .as_deref()
            .map(|s| s.chars().count())
            .unwrap_or(0);
    (chars / 4).min(u32::MAX as usize) as u32
}

/// Builds the engine request and returns the total number of redactions applied
/// across the messages + system prompt (a C6 governance signal). `mask` is the
/// workspace's DLP posture (Settings → "PII & tenant masking"); when off, content
/// passes through unredacted and the redaction count is 0.
fn build_inference_request(
    req: &ChatRequest,
    mask: bool,
    allow_fallback: bool,
) -> (InferenceRequest, u32) {
    // C4 §2 W5 — redact-in-flight: strip secrets/PII from every message and the
    // system prompt BEFORE they egress to any model (cloud especially). One-way
    // placeholders (v1). Redaction counts flow into the governance/quality signal.
    let redactor = crate::redact::Redactor;
    let mut redactions: u32 = 0;
    let mut clean_of = |s: &str| -> String {
        if !mask {
            return s.to_string();
        }
        let (clean, hits) = redactor.redact(s);
        redactions += hits.len() as u32;
        clean
    };
    let messages: Vec<Message> = req
        .messages
        .iter()
        .map(|m| Message::text(map_role(&m.role), &clean_of(&m.content)))
        .collect();
    let system = req.system.as_ref().map(|s| clean_of(s));

    let ireq = InferenceRequest {
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
        // Governance: when the workspace disabled "Automatic fallback", the engine
        // attempts only the primary model and surfaces its error instead of
        // silently stepping down the chain.
        allow_fallback,
        // F3-4 sets per-tenant BYOK credentials here from the vault key cache.
        credentials: Default::default(),
    };
    (ireq, redactions)
}

/// C3 hot-path preamble: resolve the caller's budget node and hard-reserve a
/// worst-case estimate BEFORE inference. **Fail-closed** — a token with no tenant,
/// a caller with no resolvable node, or an over-cap `hard` node is denied (402).
/// Returns `(tenant, node, hold)` for the commit/release at the end of the call.
async fn reserve_budget(
    state: &SharedState,
    claims: &Claims,
    input_est: u32,
    max_tokens: u32,
) -> Result<(Uuid, Uuid, Uuid), (StatusCode, String)> {
    let tenant = claims.tenant_id.ok_or((
        StatusCode::PAYMENT_REQUIRED,
        "budgeted access required: token carries no tenant".to_string(),
    ))?;
    let subject = Uuid::parse_str(&claims.sub).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "invalid subject in token".to_string(),
        )
    })?;

    let node = crate::budgets::resolve_node(&state.pool, tenant, subject)
        .await
        .map_err(|e| match e {
            crate::budgets::BudgetError::NoNode => (
                StatusCode::PAYMENT_REQUIRED,
                "no budget node for caller — access denied".to_string(),
            ),
            // Don't leak raw sqlx/Postgres text (table/constraint names) to the client.
            crate::budgets::BudgetError::Db(err) => {
                tracing::error!(?err, "chat: budget node resolution db error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "budget service error".to_string(),
                )
            }
            crate::budgets::BudgetError::Exceeded => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "budget error".to_string(),
            ),
        })?;

    let est = crate::budgets::estimate(input_est, max_tokens);
    // request-level idempotency (response caching) is deferred; per-request reserve
    // guarantees no shared-hold bypass (each /v1/chat gets its own cap-gated hold).
    let hold = crate::budgets::reserve(&state.pool, tenant, node, est, None)
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
            // Don't leak raw sqlx/Postgres text (table/constraint names) to the client.
            crate::budgets::BudgetError::Db(err) => {
                tracing::error!(?err, "chat: budget reserve db error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "budget service error".to_string(),
                )
            }
            crate::budgets::BudgetError::NoNode => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "budget error".to_string(),
            ),
        })?;

    Ok((tenant, node, hold))
}

/// Governance enforcement: a workspace can disable a catalog model
/// (`tenant_model_state.enabled = false`, surfaced on the admin Models screen).
/// When a caller names a model explicitly, a disabled one is refused (403) BEFORE
/// reserving budget or hitting a provider — otherwise the admin's toggle would be
/// cosmetic. Absent row = enabled (the catalog is global; workspaces opt OUT).
/// Chain-routed calls (no explicit model) are governed instead by per-step
/// activation on the Routing screen, resolved inside the engine. Fail-closed on a
/// DB error (honest 500, not a misleading "disabled").
async fn ensure_model_enabled(
    state: &SharedState,
    claims: &Claims,
    model: Option<&str>,
) -> Result<(), (StatusCode, String)> {
    let (Some(tenant), Some(model)) = (claims.tenant_id, model) else {
        return Ok(()); // no explicit model, or no tenant (reserve_budget will 402)
    };
    let enabled: bool = sqlx::query_scalar(
        "select coalesce((select enabled from public.tenant_model_state \
           where tenant_id = $1 and model_full_name = $2), true)",
    )
    .bind(tenant)
    .bind(model)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(?e, "chat: model-enablement check db error");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "governance service error".to_string(),
        )
    })?;
    if !enabled {
        return Err((
            StatusCode::FORBIDDEN,
            format!("model '{model}' is disabled for this workspace"),
        ));
    }
    Ok(())
}

/// The workspace's DLP masking posture (Settings → "PII & tenant masking"). Default ON
/// (absent setting = masked); an admin can disable it as a capability-gated, audited
/// workspace policy. Fail-safe: a DB read error keeps masking ON.
async fn masking_enabled(state: &SharedState, tenant: Option<Uuid>) -> bool {
    let Some(tenant) = tenant else { return true };
    sqlx::query_scalar::<_, bool>(
        "select coalesce((select enabled from public.tenant_settings \
           where tenant_id = $1 and setting_key = 'masking'), true)",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(true)
}

/// The workspace's "Automatic fallback" posture (Settings → step down on budget or
/// provider error without asking). Default ON (absent setting = enabled); an admin can
/// disable it as a capability-gated, audited workspace policy, pinning inference to the
/// primary model. Fail-safe: a DB read error keeps fallback ON (preserves availability).
async fn auto_fallback_enabled(state: &SharedState, tenant: Option<Uuid>) -> bool {
    let Some(tenant) = tenant else { return true };
    sqlx::query_scalar::<_, bool>(
        "select coalesce((select enabled from public.tenant_settings \
           where tenant_id = $1 and setting_key = 'autoFallback'), true)",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(true)
}

/// F3 BYOK: overlay the caller-tenant's decrypted vault keys onto the request as the
/// per-call `credentials` override (the engine prefers them over the platform/env key
/// per router). **Fail-safe** — no tenant, an empty map, or a vault error leaves the
/// request on platform keys; a bad BYOK setup never denies inference.
async fn inject_tenant_credentials(
    state: &SharedState,
    tenant: Option<Uuid>,
    ireq: &mut InferenceRequest,
) {
    let Some(tenant) = tenant else { return };
    match state.tenant_keys.get(&state.pool, tenant).await {
        Ok(creds) if !creds.is_empty() => ireq.credentials = (*creds).clone(),
        Ok(_) => {}
        Err(e) => tracing::warn!("F3: tenant key resolve failed, using platform keys: {e}"),
    }
}

/// A JSON error `Response` (used by the streaming handler, which can't `?`-return a tuple).
fn error_response(code: StatusCode, msg: &str) -> Response {
    Response::builder()
        .status(code)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::json!({ "error": msg }).to_string()))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .unwrap()
        })
}

// ---------------------------------------------------------------------------
// POST /v1/chat
// ---------------------------------------------------------------------------

pub async fn post_chat(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    let mask = masking_enabled(&state, claims.tenant_id).await;
    let allow_fallback = auto_fallback_enabled(&state, claims.tenant_id).await;
    let (mut ireq, redactions) = build_inference_request(&req, mask, allow_fallback);
    inject_tenant_credentials(&state, claims.tenant_id, &mut ireq).await;
    let max_tokens = req.max_tokens.unwrap_or(1024);
    let input_est = estimate_input_tokens(&req);

    // Governance: refuse a workspace-disabled named model before spending anything.
    ensure_model_enabled(&state, &claims, req.model.as_deref()).await?;

    // C3: resolve the caller's budget node + hard reserve BEFORE inference (fail-closed).
    // request-level idempotency (response caching) is deferred; every request performs
    // its own independent cap-gated reserve → no shared-hold budget bypass.
    let (tenant, node, hold) = reserve_budget(&state, &claims, input_est, max_tokens).await?;

    let start = Instant::now();
    let exec = state.gateway.execute(&ireq).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    let resp = match exec {
        Ok(r) => r,
        Err(e) => {
            // inference failed — release the hold so no headroom is consumed.
            let _ = crate::budgets::release(&state.pool, tenant, hold).await;
            // Don't disclose upstream/provider internals to the client — log server-side.
            tracing::error!("chat: gateway execute error: {}", e);
            return Err((
                StatusCode::BAD_GATEWAY,
                "upstream provider error".to_string(),
            ));
        }
    };

    // --- Map response ---
    // C4 governance: redact the model's OUTPUT before it reaches the client (a model
    // must not echo a secret back out) and count redactions for the governance signal.
    // Honors the same workspace masking posture as the input side.
    let (content, output_redactions) = {
        let raw = resp.content.clone().unwrap_or_default();
        if mask {
            let (clean, hits) = crate::redact::Redactor.redact(&raw);
            (clean, hits.len() as u32)
        } else {
            (raw, 0)
        }
    };
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
        tracing::warn!(
            "chat: budget commit failed (spend not recorded on node): {}",
            e
        );
    }

    let chat_response = ChatResponse {
        content,
        model: model.clone(),
        cost_usd,
        input_tokens,
        output_tokens,
    };

    // --- Persist (best-effort) — tenant is known (reserve_budget errored otherwise) ---
    let main_call_id = Uuid::new_v4(); // hoisted so the C6 judge can key its score to it
    {
        let successful_attempt = resp.attempts.last();
        let adapter = successful_attempt
            .map(|a| a.adapter.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let api_model_id = successful_attempt.map(|a| a.api_model_id.clone());

        let call = InferenceCall {
            id: main_call_id,
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
        } else {
            // C6: one implicit quality-signal batch per call, keyed to the ledger row.
            let exec_loc = if call.adapter.contains("embedded")
                || call.adapter.contains("ollama")
                || call.adapter.contains("llama")
            {
                "local"
            } else {
                "cloud"
            };
            crate::quality::record_call_signals(
                &state.pool,
                tenant,
                &crate::quality::CallSignals {
                    inference_call_id: call.id,
                    actor_id: Some(node),
                    latency_ms: duration_ms,
                    cost_usd,
                    input_tokens,
                    output_tokens,
                    redactions,
                    execution_location: exec_loc.to_string(),
                    success: resp.success,
                },
            )
            .await;

            // C4: governance signal — redaction counts, prompt-injection flag, and the
            // "why-this-model" routing trace (advisory in v1; classification defaults to
            // 'internal' until C5/RAG supplies per-space/citation classification).
            let injection = req
                .messages
                .iter()
                .any(|m| crate::governance::scan_injection(&m.content));
            let why = crate::governance::why_model(
                &call.model,
                &call.adapter,
                resp.attempts.len(),
                req.chain.as_deref(),
            );
            let gov = serde_json::json!({
                "input_redactions": redactions,
                "output_redactions": output_redactions,
                "injection_suspected": injection,
                "why_model": why,
                "classification": "internal",
            });
            let _ = sqlx::query(
                "insert into public.quality_signals \
                   (tenant_id, id, inference_call_id, signal_key, signal_class, \
                    value_json, source, actor_id, schema_version) \
                 values ($1, gen_random_uuid(), $2, 'governance', 'implicit', \
                         $3::jsonb, 'gateway', $4, 1)",
            )
            .bind(tenant)
            .bind(call.id)
            .bind(gov.to_string())
            .bind(node)
            .execute(&state.pool)
            .await;
        }
    }

    // C6: opt-in LLM-as-judge — score the response on the local `judge` chain (gemma4,
    // $0), spawned so it never adds latency to this response. Default-off per tenant.
    if crate::judge::judge_enabled(&state, tenant).await {
        let question = req
            .messages
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .map(|m| m.content.clone())
            .unwrap_or_default();
        let answer = chat_response.content.clone();
        tokio::spawn(crate::judge::judge_response(
            state.clone(),
            tenant,
            node,
            main_call_id,
            question,
            answer,
        ));
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
    let mask = masking_enabled(&state, claims.tenant_id).await;
    let allow_fallback = auto_fallback_enabled(&state, claims.tenant_id).await;
    let (mut ireq, redactions) = build_inference_request(&req, mask, allow_fallback);
    inject_tenant_credentials(&state, claims.tenant_id, &mut ireq).await;
    let max_tokens = req.max_tokens.unwrap_or(1024);
    let input_est = estimate_input_tokens(&req);

    // Governance: refuse a workspace-disabled named model before opening the stream.
    if let Err((code, msg)) = ensure_model_enabled(&state, &claims, req.model.as_deref()).await {
        return error_response(code, &msg);
    }

    // C3: resolve budget node + hard reserve BEFORE streaming (fail-closed). A denied
    // caller gets a synchronous JSON error — the stream is never opened (no bypass).
    // request-level idempotency (response caching) is deferred; every request performs
    // its own independent cap-gated reserve → no shared-hold budget bypass.
    let (tenant, node, hold) = match reserve_budget(&state, &claims, input_est, max_tokens).await {
        Ok(v) => v,
        Err((code, msg)) => return error_response(code, &msg),
    };

    // Channel that carries SSE-formatted lines as raw bytes.
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, std::convert::Infallible>>(32);

    tokio::spawn(async move {
        let start = Instant::now();
        match state.gateway.execute(&ireq).await {
            Ok(resp) => {
                // C4 governance: redact the model's OUTPUT before it streams to the client
                // (parity with post_chat), honoring the workspace masking posture.
                let raw = resp.content.clone().unwrap_or_default();
                let out = if mask {
                    crate::redact::Redactor.redact(&raw).0
                } else {
                    raw
                };
                let chunk = serde_json::json!({
                    "content": out,
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

                    let store = PgGatewayStore {
                        pool: state.pool.clone(),
                        tenant_id: tenant,
                    };
                    if let Err(e) = store.insert_inference_call(&call).await {
                        tracing::warn!("chat/stream: persist failed (best-effort): {}", e);
                    } else {
                        // C6: one implicit quality-signal batch per call, keyed to the ledger row.
                        let exec_loc = if call.adapter.contains("embedded")
                            || call.adapter.contains("ollama")
                            || call.adapter.contains("llama")
                        {
                            "local"
                        } else {
                            "cloud"
                        };
                        crate::quality::record_call_signals(
                            &state.pool,
                            tenant,
                            &crate::quality::CallSignals {
                                inference_call_id: call.id,
                                actor_id: Some(node),
                                latency_ms: duration_ms,
                                cost_usd,
                                input_tokens: call.input_tokens,
                                output_tokens: call.output_tokens,
                                redactions,
                                execution_location: exec_loc.to_string(),
                                success: true,
                            },
                        )
                        .await;
                    }
                }
            }
            Err(e) => {
                // inference failed — release the hold (no spend).
                let _ = crate::budgets::release(&state.pool, tenant, hold).await;
                // Don't disclose upstream/provider internals to the client — log server-side.
                tracing::error!("chat/stream: gateway execute error: {}", e);
                let _ = tx.send(Ok(sse_error("upstream provider error"))).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn req_with(content: &str) -> ChatRequest {
        ChatRequest {
            messages: vec![ChatMessage {
                role: "user".into(),
                content: content.into(),
            }],
            model: None,
            chain: None,
            system: None,
            max_tokens: Some(16),
        }
    }

    // The masking toggle must actually gate C4 redaction: on → secrets stripped from
    // input (redaction count > 0); off → content egresses verbatim (count == 0).
    #[test]
    fn masking_gates_input_redaction() {
        let secret = "my key is AKIAIOSFODNN7EXAMPLE"; // canonical AWS example key
        let (_, on) = build_inference_request(&req_with(secret), true, true);
        assert!(on > 0, "masking on must redact the AWS key");
        let (_, off) = build_inference_request(&req_with(secret), false, true);
        assert_eq!(off, 0, "masking off must not redact");
    }
}
