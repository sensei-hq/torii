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
    store::{CallStatus, GatewayStore, InferenceCall, StoredTrace},
    types::{
        capability::Capability,
        request::{
            InferenceRequest, InferenceResponse, Message, MessageContent, MessageRole, Payload,
            ToolDefinition,
        },
        trace::{ExecutionTrace, TraceStatus},
    },
};

use tools::{
    run_tool_loop, AllowListResolver, InvokeCtx, ModelTurn, ToolDef, ToolInvocation, ToolInvoker,
    ToolLoopConfig, ToolResultMessage, TurnOutput,
};

use crate::{
    auth::Claims,
    routes::mcp::{resolve_ctx, GatewayAudit, GatewayRedactor, GatewayTransport},
    state::SharedState,
    store::PgGatewayStore,
};

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
    /// X1 (P11): the space whose (role×space) tool allow-list applies. Optional — with no space
    /// only role-wide grants resolve.
    #[serde(default)]
    pub space_id: Option<Uuid>,
    /// X1: `"auto"` enables the MCP agentic tool loop (offering only allow-listed tools); any
    /// other value / absent = no tools (the existing single-shot path, unchanged).
    #[serde(default)]
    pub tools: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: Option<String>,
    pub cost_usd: f64,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    /// X1: per-tool provenance for an agentic answer (`governance.tools[]`) — server/tool/
    /// outcome/redaction type+count/plane/latency, never raw args/output. Empty for plain chat.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<tools::ToolProvenance>,
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
        .map(|m| Message::text(map_role(&m.role), clean_of(&m.content)))
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
pub(crate) async fn reserve_budget(
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

/// Governance enforcement (§D Phase 3): model enablement is DERIVED from chain membership —
/// a model is usable iff it's in one of the tenant's active, key-configured CHAT chains
/// (catalog.chains_for_tenant). When a caller names a model explicitly, one that is in no viable
/// chat chain (never configured, or its router has no key) is refused (403) BEFORE reserving budget
/// or hitting a provider — a clean early block instead of a later no-key failure. This default-DENY
/// replaces the retired `tenant_model_state` toggle ('absent row = enabled' is gone); the admin
/// Models screen surfaces the same derived `enabled` read-only. Chain-routed calls (no explicit
/// model) are governed by per-step activation on the Routing screen, resolved inside the engine.
/// Fail-closed on a DB error (honest 500, not a misleading "disabled").
pub(crate) async fn ensure_model_enabled(
    state: &SharedState,
    claims: &Claims,
    model: Option<&str>,
) -> Result<(), (StatusCode, String)> {
    let (Some(tenant), Some(model)) = (claims.tenant_id, model) else {
        return Ok(()); // no explicit model, or no tenant (reserve_budget will 402)
    };
    // §D Phase 3: enablement is DERIVED from chain membership (tenant_model_state retired). A
    // directly-requested model is allowed iff it is in one of the tenant's resolved+viable CHAT
    // chains — the same derivation as /v1/models/available, so the gate and the picker agree. A
    // model in no viable chat chain (never configured, or its router has no key) is a hard block.
    let enabled: bool = sqlx::query_scalar(
        "select exists( \
           select 1 from catalog.chains_for_tenant cft \
             join catalog.capability_types c on c.id = cft.capability_id \
            where cft.tenant_id = $1 and cft.model_full_name = $2 and c.name = 'chat')",
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
            format!("model '{model}' is not enabled for this workspace"),
        ));
    }
    Ok(())
}

/// The workspace's DLP masking posture (Settings → "PII & tenant masking"). Default ON
/// (absent setting = masked); an admin can disable it as a capability-gated, audited
/// workspace policy. Fail-safe: a DB read error keeps masking ON.
pub(crate) async fn masking_enabled(state: &SharedState, tenant: Option<Uuid>) -> bool {
    let Some(tenant) = tenant else { return true };
    // §D Phase 4: reads the workspace toggle via the settings_for_tenant shield (governance.settings
    // absorbed tenant_settings). Fail-safe preserved: absent row → masking ON, DB error → ON.
    sqlx::query_scalar::<_, bool>(
        "select coalesce((select enabled from governance.settings_for_tenant \
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
pub(crate) async fn auto_fallback_enabled(state: &SharedState, tenant: Option<Uuid>) -> bool {
    let Some(tenant) = tenant else { return true };
    // §D Phase 4: workspace toggle via the settings_for_tenant shield. Fail-safe: absent/DB error → ON.
    sqlx::query_scalar::<_, bool>(
        "select coalesce((select enabled from governance.settings_for_tenant \
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
pub(crate) async fn inject_tenant_credentials(
    state: &SharedState,
    tenant: Option<Uuid>,
    ireq: &mut InferenceRequest,
) {
    let Some(tenant) = tenant else { return };
    // api_key credentials (raw values → the engine's x-api-key path).
    match state.tenant_keys.get(tenant).await {
        Ok(creds) if !creds.is_empty() => ireq.credentials = (*creds).clone(),
        Ok(_) => {}
        Err(e) => tracing::warn!("F3: tenant key resolve failed, using platform keys: {e}"),
    }
    // OAuth credentials — marked with the kernel `oauth:` prefix so the adapter presents them
    // as a bearer token. Overlaid on the same map keyed by router name; a router with both an
    // api_key and an oauth credential gets the oauth one (the adapter honours the marker).
    match state.tenant_keys.get_oauth(tenant).await {
        Ok(oauth) => {
            for (router, token) in oauth.iter() {
                ireq.credentials.insert(
                    router.clone(),
                    format!("{}{}", gateway::types::credential::OAUTH_PREFIX, token),
                );
            }
        }
        Err(e) => tracing::warn!("F3: tenant oauth resolve failed, using platform keys: {e}"),
    }
}

/// Snapshot the engine's routing decision as an `ExecutionTrace` for the ledger, linked to
/// the ledger row `call_id`. The engine returns the ordered `attempts` chain on the response
/// — each hop's adapter/model/status/duration plus the error that forced a fallback — which
/// is exactly the "why this model" story Activity/Requests replay per call. The engine's
/// internal candidate/skipped lists are not surfaced on the response, so those stay empty.
pub(crate) fn build_trace(
    call_id: Uuid,
    capability: Capability,
    resp: &InferenceResponse,
    duration_ms: u64,
    recorded_at: chrono::DateTime<Utc>,
) -> StoredTrace {
    let trace = ExecutionTrace {
        request_id: call_id.to_string(),
        capability,
        status: if resp.success {
            TraceStatus::Success
        } else {
            TraceStatus::Failed
        },
        duration_ms,
        candidates: Vec::new(),
        skipped: Vec::new(),
        attempts: resp.attempts.clone(),
        estimated_cost: resp.estimated_cost.clone(),
        actual_cost: resp.actual_cost.clone(),
        created_at: recorded_at,
    };
    StoredTrace {
        id: Uuid::new_v4(),
        inference_call_id: Some(call_id),
        trace,
        created_at: recorded_at,
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
    // X1 (P11): opt-in MCP agentic tool loop. Gated on `tools == "auto"` so every existing caller
    // (no `tools` field) takes the unchanged single-shot path below — no regression.
    if req.tools.as_deref() == Some("auto") {
        return post_chat_with_tools(&claims, &state, &req).await;
    }
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
        tools: Vec::new(),
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
            // Per-call routing trace (the "why this model" attempt chain) → execution_traces,
            // linked to this ledger row. Best-effort: a trace failure never affects the answer.
            let stored_trace =
                build_trace(call.id, call.capability.clone(), &resp, duration_ms, call.recorded_at);
            if let Err(e) = store.insert_execution_trace(&stored_trace).await {
                tracing::warn!("chat: persist execution_trace failed (best-effort): {}", e);
            }
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
                    // Hoist the id/timestamp so the ledger row + its routing trace share them,
                    // and snapshot the trace while `resp` is still fully intact (before its
                    // `model` field is moved into the call below).
                    let call_id = Uuid::new_v4();
                    let recorded_at = Utc::now();
                    let stored_trace =
                        build_trace(call_id, Capability::TextChat, &resp, duration_ms, recorded_at);
                    let successful_attempt = resp.attempts.last();
                    let adapter = successful_attempt
                        .map(|a| a.adapter.clone())
                        .unwrap_or_else(|| "unknown".to_string());
                    let api_model_id = successful_attempt.map(|a| a.api_model_id.clone());

                    let call = InferenceCall {
                        id: call_id,
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
                        recorded_at,
                    };

                    let store = PgGatewayStore {
                        pool: state.pool.clone(),
                        tenant_id: tenant,
                    };
                    if let Err(e) = store.insert_inference_call(&call).await {
                        tracing::warn!("chat/stream: persist failed (best-effort): {}", e);
                    } else {
                        // Per-call routing trace → execution_traces (best-effort), like post_chat.
                        if let Err(e) = store.insert_execution_trace(&stored_trace).await {
                            tracing::warn!(
                                "chat/stream: persist execution_trace failed (best-effort): {}",
                                e
                            );
                        }
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

// ---------------------------------------------------------------------------
// X1 (P11) · agentic MCP tool loop over /v1/chat
// ---------------------------------------------------------------------------

/// The tools-enabled path: resolve the caller's default-deny `(role×space)` allow-list, then run
/// the bounded agentic loop (offering ONLY allowed tools; every tool call enforced + redacted by
/// the runtime). Budget is metered per model turn (reserve→commit each turn). Returns the answer
/// + `governance.tools[]` provenance. On any resolver error we offer NO tools (fail-safe) rather
/// than opening the surface.
async fn post_chat_with_tools(
    claims: &Claims,
    state: &SharedState,
    req: &ChatRequest,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    let tenant = claims.tenant_id.ok_or((
        StatusCode::PAYMENT_REQUIRED,
        "budgeted access required: token carries no tenant".to_string(),
    ))?;
    let rctx = resolve_ctx(claims).ok_or((
        StatusCode::FORBIDDEN,
        "no tenant/roles resolved for tool use".to_string(),
    ))?;

    // O3-2 governance: a policy can disable the whole tools feature (a locked/off kill-switch)
    // regardless of grants. Ungoverned (no policy) → the allow-list is the gate.
    let tools_gov =
        crate::routes::config::resolve_feature(&state.pool, tenant, &claims.role_ids, "tools", req.space_id)
            .await;
    let allowed = if tools_gov.governed && !tools_gov.enabled {
        tracing::info!(
            "chat/tools: tools feature disabled by governance ({}) — offering no tools",
            tools_gov.source
        );
        Default::default()
    } else {
        // Default-deny: a resolver error offers NO tools (never widen the surface on failure).
        AllowListResolver::new(&state.pool)
            .resolve(&rctx, req.space_id)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!("chat/tools: allow-list resolve failed, offering no tools: {e}");
                Default::default()
            })
    };

    let mask = masking_enabled(state, Some(tenant)).await;
    let allow_fallback = auto_fallback_enabled(state, Some(tenant)).await;

    // Redact the base prompt in-flight (parity with the single-shot path).
    let clean = |s: &str| -> String {
        if mask {
            crate::redact::Redactor.redact(s).0
        } else {
            s.to_string()
        }
    };
    let base: Vec<Message> = req
        .messages
        .iter()
        .map(|m| Message::text(map_role(&m.role), clean(&m.content)))
        .collect();
    let system = req.system.as_ref().map(|s| clean(s));

    let turn = GatewayModelTurn {
        state,
        claims,
        tenant,
        mask,
        allow_fallback,
        max_tokens: req.max_tokens.unwrap_or(1024),
        system,
        messages: std::sync::Mutex::new(base),
        total_cost: std::sync::Mutex::new(0.0),
        last_model: std::sync::Mutex::new(None),
    };
    let transport = GatewayTransport {
        pool: state.pool.clone(),
    };
    let redactor = GatewayRedactor { mask };
    let audit = GatewayAudit {
        pool: state.pool.clone(),
    };
    let invoker = ToolInvoker::new(&transport, &redactor, &audit);
    let ictx = InvokeCtx {
        tenant_id: tenant,
        actor_id: rctx.actor_id,
    };

    let result = run_tool_loop(&ToolLoopConfig::default(), &ictx, &allowed, &invoker, &turn)
        .await
        .map_err(|e| {
            tracing::error!("chat/tools: loop error: {e}");
            (StatusCode::BAD_GATEWAY, "tool loop error".to_string())
        })?;

    let model = turn.last_model.lock().unwrap().clone();
    let cost_usd = *turn.total_cost.lock().unwrap();
    Ok(Json(ChatResponse {
        content: result.answer,
        model,
        cost_usd,
        input_tokens: None,
        output_tokens: None,
        tools: result.provenance,
    }))
}

/// One metered model turn for the agentic loop. Owns the growing engine transcript (interior
/// mutable) + the running cost/model, so the pure `crates/tools` driver stays engine-independent.
struct GatewayModelTurn<'a> {
    state: &'a SharedState,
    claims: &'a Claims,
    tenant: Uuid,
    mask: bool,
    allow_fallback: bool,
    max_tokens: u32,
    system: Option<String>,
    /// user/assistant/tool messages accumulated across turns (NOT the system prompt).
    messages: std::sync::Mutex<Vec<Message>>,
    total_cost: std::sync::Mutex<f64>,
    last_model: std::sync::Mutex<Option<String>>,
}

#[async_trait::async_trait]
impl ModelTurn for GatewayModelTurn<'_> {
    async fn turn(
        &self,
        tools_offered: &[ToolDef],
        results: &[ToolResultMessage],
    ) -> Result<TurnOutput, tools::ToolError> {
        // Append the prior round's tool results, then snapshot the transcript (lock never held
        // across an await).
        let snapshot = {
            let mut msgs = self.messages.lock().unwrap();
            for r in results {
                msgs.push(Message::tool_result(r.id.clone(), r.content.clone()));
            }
            msgs.clone()
        };

        // Offer ONLY the resolved allowed tools (default-deny at the offer point).
        let tool_defs: Vec<ToolDefinition> = tools_offered
            .iter()
            .map(|t| ToolDefinition {
                name: t.offered_name.clone(),
                description: t.description.clone(),
                input_schema: t.input_schema.clone(),
            })
            .collect();

        let input_est = (snapshot
            .iter()
            .map(|m| m.content.as_text().chars().count())
            .sum::<usize>()
            / 4)
        .min(u32::MAX as usize) as u32;

        let mut ireq = InferenceRequest {
            capability: Capability::TextChat,
            model: None,
            router: None,
            chain: Some("chat".to_string()),
            payload: Payload::Chat {
                messages: snapshot,
                system: self.system.clone(),
                max_tokens: Some(self.max_tokens),
                temperature: None,
                tools: tool_defs,
            },
            budget: None,
            auth: None,
            panel: None,
            consensus: None,
            allow_fallback: self.allow_fallback,
            credentials: Default::default(),
        };
        inject_tenant_credentials(self.state, Some(self.tenant), &mut ireq).await;

        // Per-turn budget reserve (D6: one metered call per turn).
        let (_t, node, hold) = reserve_budget(self.state, self.claims, input_est, self.max_tokens)
            .await
            .map_err(|(code, msg)| tools::ToolError::Transport(format!("budget {code}: {msg}")))?;

        let start = Instant::now();
        let exec = self.state.gateway.execute(&ireq).await;
        let duration_ms = start.elapsed().as_millis() as u64;
        let resp = match exec {
            Ok(r) => r,
            Err(e) => {
                let _ = crate::budgets::release(&self.state.pool, self.tenant, hold).await;
                return Err(tools::ToolError::Transport(format!("engine: {e}")));
            }
        };

        let cost = resp
            .actual_cost
            .as_ref()
            .map(|c| c.total_cost)
            .or_else(|| resp.estimated_cost.as_ref().map(|e| e.estimated))
            .unwrap_or(0.0);
        if let Err(e) = crate::budgets::commit(&self.state.pool, self.tenant, hold, cost).await {
            tracing::warn!("chat/tools: budget commit failed: {e}");
        }
        *self.total_cost.lock().unwrap() += cost;
        if let Some(m) = &resp.model {
            *self.last_model.lock().unwrap() = Some(m.clone());
        }

        // Ledger row + trace per turn, so agentic turns show in Activity like any inference.
        let store = PgGatewayStore {
            pool: self.state.pool.clone(),
            tenant_id: self.tenant,
        };
        let call = InferenceCall {
            id: Uuid::new_v4(),
            session_id: None,
            project_id: None,
            subject_id: Some(node),
            tier: None,
            capability: Capability::TextChat,
            chain_id: Some("chat".to_string()),
            adapter: resp
                .attempts
                .last()
                .map(|a| a.adapter.clone())
                .unwrap_or_else(|| "unknown".to_string()),
            model: resp.model.clone().unwrap_or_default(),
            api_model_id: resp.attempts.last().map(|a| a.api_model_id.clone()),
            input_tokens: resp.usage.as_ref().map(|u| u.input_tokens),
            output_tokens: resp.usage.as_ref().map(|u| u.output_tokens),
            cost_usd: cost,
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
        if store.insert_inference_call(&call).await.is_ok() {
            let stored_trace =
                build_trace(call.id, call.capability.clone(), &resp, duration_ms, call.recorded_at);
            let _ = store.insert_execution_trace(&stored_trace).await;
        }

        // Tool calls → dispatch; otherwise the (redacted) final answer.
        if resp.tool_calls.is_empty() {
            let raw = resp.content.clone().unwrap_or_default();
            let answer = if self.mask {
                crate::redact::Redactor.redact(&raw).0
            } else {
                raw
            };
            Ok(TurnOutput::Answer(answer))
        } else {
            // Record the assistant's tool-call turn so the next turn's tool_results thread to it.
            {
                let mut msgs = self.messages.lock().unwrap();
                msgs.push(Message {
                    role: MessageRole::Assistant,
                    content: MessageContent::Text {
                        text: resp.content.clone().unwrap_or_default(),
                    },
                    tool_calls: resp.tool_calls.clone(),
                    attachments: Vec::new(),
                });
            }
            let calls = resp
                .tool_calls
                .iter()
                .map(|tc| ToolInvocation {
                    id: tc.id.clone(),
                    offered_name: tc.name.clone(),
                    arguments: tc.arguments.clone(),
                })
                .collect();
            Ok(TurnOutput::ToolCalls(calls))
        }
    }
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
            space_id: None,
            tools: None,
        }
    }

    // A 2-attempt response (primary failed → local fallback answered) becomes a trace whose
    // attempt chain preserves order + the fallback error, and whose status mirrors success —
    // the per-call "why this model" data Activity/Requests replay.
    #[test]
    fn build_trace_captures_the_attempt_chain() {
        use gateway::types::trace::{Attempt, AttemptStatus, TraceStatus};

        fn attempt(
            sequence: u8,
            adapter: &str,
            model: &str,
            status: AttemptStatus,
            error: Option<&str>,
            fallback_triggered: bool,
        ) -> Attempt {
            Attempt {
                sequence,
                adapter: adapter.into(),
                model: model.into(),
                api_model_id: model.into(),
                status,
                duration_ms: 10,
                tokens: None,
                cost: None,
                error: error.map(|e| e.to_string()),
                fallback_triggered,
            }
        }

        let resp = InferenceResponse {
            success: true,
            content: Some("hi".into()),
            embeddings: None,
            transcription: None,
            audio: None,
            images: None,
            videos: None,
            model: Some("gemma2:2b".into()),
            usage: None,
            tool_calls: Vec::new(),
            estimated_cost: None,
            actual_cost: None,
            attempts: vec![
                attempt(
                    1,
                    "anthropic",
                    "claude-sonnet-4-5",
                    AttemptStatus::Failed,
                    Some("429 rate limited"),
                    true,
                ),
                attempt(2, "ollama", "gemma2:2b", AttemptStatus::Success, None, false),
            ],
        };

        let call_id = Uuid::new_v4();
        let now = Utc::now();
        let stored = build_trace(call_id, Capability::TextChat, &resp, 1_500, now);

        assert_eq!(stored.inference_call_id, Some(call_id));
        assert_eq!(stored.trace.request_id, call_id.to_string());
        assert_eq!(stored.trace.duration_ms, 1_500);
        assert!(matches!(stored.trace.status, TraceStatus::Success));
        assert_eq!(stored.trace.attempts.len(), 2);
        // the first hop is the failed primary, carrying the error that triggered the fallback.
        assert_eq!(stored.trace.attempts[0].status, AttemptStatus::Failed);
        assert!(stored.trace.attempts[0].fallback_triggered);
        assert_eq!(
            stored.trace.attempts[0].error.as_deref(),
            Some("429 rate limited")
        );
        // the winning hop is the local fallback that actually answered.
        assert_eq!(stored.trace.attempts[1].adapter, "ollama");
        assert_eq!(stored.trace.attempts[1].status, AttemptStatus::Success);
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
