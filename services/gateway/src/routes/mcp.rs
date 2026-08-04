//! X1 (P11) · C1 wiring for the Torii MCP tool runtime (`crates/tools`).
//!
//! Hosts the runtime's injected collaborators on the central plane — the DLP redactor
//! ([`GatewayRedactor`]), the SSRF-filtered transport factory ([`GatewayTransport`]), and the
//! audit sink ([`GatewayAudit`]) — plus the `/rpc/mcp/*` registry write handlers that populate
//! the server + discovered-tool cache the allow-list resolves against. The agentic tool loop
//! that consumes these lives in [`super::chat`] (the `/v1/chat` hot path).

use std::time::Duration;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use async_trait::async_trait;
use tools::{
    discover_and_cache, offered_name as tool_offered_name, Direction, EgressFilter, EgressPolicy,
    HttpClient, McpClient, RedactionSummary, ResolveCtx, StdResolver, ToolAudit, ToolAuditSink,
    ToolBinding, ToolError, ToolRedactor, ToolTransport, Transport as ToolTransportKind,
};

use crate::{auth::Claims, routes::rpc::authorize, state::SharedState};

/// The default per-tool-call HTTP timeout (also used for discovery).
const TOOL_TIMEOUT: Duration = Duration::from_secs(20);

// ---------------------------------------------------------------------------
// Runtime collaborators (injected into crates/tools)
// ---------------------------------------------------------------------------

/// C4 W5 tool-egress redaction, over the gateway's `redact::Redactor`. Fail-open only when the
/// workspace disabled masking (parity with chat); otherwise every hit is stripped and summarized
/// by type. NB: `redact::Redactor` is infallible today, so this never returns `Err` — the
/// fail-closed contract still holds structurally (a future fallible detector maps its fault here).
pub struct GatewayRedactor {
    pub mask: bool,
}

impl ToolRedactor for GatewayRedactor {
    fn redact(
        &self,
        direction: Direction,
        text: &str,
    ) -> Result<(String, Vec<RedactionSummary>), ToolError> {
        if !self.mask {
            return Ok((text.to_string(), Vec::new()));
        }
        let (clean, hits) = crate::redact::Redactor.redact(text);
        let summaries = hits
            .into_iter()
            .map(|h| RedactionSummary {
                direction,
                r#type: h.kind.to_string(),
                count: h.count as u32,
            })
            .collect();
        Ok((clean, summaries))
    }
}

/// Builds an SSRF-filtered [`McpClient`] for a resolved tool's server. Looks the server's
/// transport + url up by id; `http`/`sse` go through the pinned [`EgressFilter`]; `stdio` is
/// **refused centrally** (device-only, D2). Credential injection from the F3 vault is a tracked
/// v1 follow-up (unauthenticated servers work today).
pub struct GatewayTransport {
    pub pool: sqlx::PgPool,
}

#[async_trait]
impl ToolTransport for GatewayTransport {
    async fn client_for(&self, binding: &ToolBinding) -> Result<Box<dyn McpClient>, ToolError> {
        if binding.transport == ToolTransportKind::Stdio {
            return Err(ToolError::DeviceOnly);
        }
        let row = sqlx::query("select url from device.mcp_servers where id = $1")
            .bind(binding.key.server_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| ToolError::Config(e.to_string()))?
            .ok_or_else(|| ToolError::Config("mcp server not found".into()))?;
        let url: Option<String> = row.get("url");
        let url = url.ok_or_else(|| ToolError::Config("http/sse server has no url".into()))?;
        let filter = EgressFilter::new(StdResolver, EgressPolicy::default());
        let client = HttpClient::connect(&filter, &url, None, TOOL_TIMEOUT)?;
        Ok(Box::new(client))
    }
}

/// Writes one `audit_events` row per tool invocation attempt — safe metadata only (server,
/// tool, outcome, redaction type/counts, plane, latency). Best-effort: an audit write failure
/// never affects the invocation result (logged).
pub struct GatewayAudit {
    pub pool: sqlx::PgPool,
}

#[async_trait]
impl ToolAuditSink for GatewayAudit {
    async fn record(&self, entry: &ToolAudit) {
        let data = json!({
            "server": entry.server,
            "tool": entry.tool,
            "outcome": entry.outcome,
            "redactions": entry.redactions,
            "plane": entry.plane,
            "latency_ms": entry.latency_ms,
            "reason": entry.reason,
        });
        let res = sqlx::query(
            "insert into audit.audit_events (tenant_id, actor_id, action, target_type, data) \
             values ($1, $2, 'mcp.tool.invoke', 'mcp_tool', $3)",
        )
        .bind(entry.tenant_id)
        .bind(entry.actor_id)
        .bind(&data)
        .execute(&self.pool)
        .await;
        if let Err(e) = res {
            tracing::warn!("mcp: tool audit write failed (best-effort): {e}");
        }
    }
}

/// Bridge the JWT claims to a tool [`ResolveCtx`]. `role_ids` come straight off the token (F2
/// §4.1) — no query. The plane is always `Cloud` on the central gateway.
pub fn resolve_ctx(claims: &Claims) -> Option<ResolveCtx> {
    Some(ResolveCtx {
        tenant_id: claims.tenant_id?,
        actor_id: Uuid::parse_str(&claims.sub).ok()?,
        role_ids: claims.role_ids.clone(),
        plane: tools::Plane::Cloud,
    })
}

/// The namespaced function name a `(server_name, tool_name)` is offered under — re-exported so
/// `chat` maps an engine tool call back to a binding without duplicating the convention.
pub fn offered(server_name: &str, tool_name: &str) -> String {
    tool_offered_name(server_name, tool_name)
}

// ---------------------------------------------------------------------------
// /rpc/mcp/* registry write handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RegisterServer {
    pub name: String,
    /// `http` | `sse` — `stdio` is refused centrally (device-registrable only, D2).
    pub transport: String,
    pub url: Option<String>,
    pub label: Option<String>,
}

/// `POST /rpc/mcp/register-server` — register a tenant `http`/`sse` MCP server + discover its
/// tools. Capability `mcp.manage`, `service_role` write, audited. Discovery is best-effort (an
/// unreachable server still registers; its tools populate on the next `refresh-tools`).
pub async fn register_server(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<RegisterServer>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "mcp.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if body.transport == "stdio" {
        return (
            StatusCode::BAD_REQUEST,
            "stdio servers are device-registrable only",
        )
            .into_response();
    }
    if body.transport != "http" && body.transport != "sse" {
        return (StatusCode::BAD_REQUEST, "transport must be http or sse").into_response();
    }
    if body.url.as_deref().unwrap_or("").is_empty() {
        return (StatusCode::BAD_REQUEST, "http/sse servers require a url").into_response();
    }

    let server_id: Result<Uuid, _> = sqlx::query_scalar(
        "insert into device.mcp_servers (tenant_id, scope, name, label, transport, url, created_by) \
         values ($1, 'tenant', $2, $3, $4::device.mcp_transport, $5, $6) returning id",
    )
    .bind(tenant)
    .bind(&body.name)
    .bind(&body.label)
    .bind(&body.transport)
    .bind(&body.url)
    .bind(actor.to_string())
    .fetch_one(&state.pool)
    .await;
    let server_id = match server_id {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("register_server: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "register failed").into_response();
        }
    };

    // Best-effort discovery — never fail the register if the server is unreachable right now.
    let discovered = discover_now(&state, server_id, &body.transport, body.url.as_deref()).await;

    let _ = sqlx::query(
        "insert into audit.audit_events (tenant_id, actor_id, action, target_type, target_id, data) \
         values ($1, $2, 'mcp.server.register', 'mcp_server', $3, $4)",
    )
    .bind(tenant)
    .bind(actor)
    .bind(server_id)
    .bind(json!({ "name": body.name, "transport": body.transport, "discovered": discovered }))
    .execute(&state.pool)
    .await;

    crate::routes::config::bump(&state.pool, tenant, "tools").await;

    (
        StatusCode::OK,
        Json(json!({ "server_id": server_id, "discovered": discovered })),
    )
        .into_response()
}

#[derive(Deserialize)]
pub struct RefreshTools {
    pub server_id: Uuid,
}

/// `POST /rpc/mcp/refresh-tools` — re-run `tools/list` for a visible server + reconcile its
/// cache. Capability `mcp.manage`.
pub async fn refresh_tools(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<RefreshTools>,
) -> Response {
    let (tenant, _actor) = match authorize(&state, &claims, "mcp.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    // The server must be visible to the caller's tenant (platform or own).
    let row = sqlx::query(
        "select transport::text as transport, url from device.mcp_servers \
         where id = $1 and (tenant_id is null or tenant_id = $2)",
    )
    .bind(body.server_id)
    .bind(tenant)
    .fetch_optional(&state.pool)
    .await;
    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return (StatusCode::NOT_FOUND, "server not found").into_response(),
        Err(e) => {
            tracing::error!("refresh_tools: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "refresh failed").into_response();
        }
    };
    let transport: String = row.get("transport");
    let url: Option<String> = row.get("url");
    match discover_now(&state, body.server_id, &transport, url.as_deref()).await {
        Some(n) => {
            crate::routes::config::bump(&state.pool, tenant, "tools").await;
            (StatusCode::OK, Json(json!({ "discovered": n }))).into_response()
        }
        None => (
            StatusCode::BAD_GATEWAY,
            "could not reach the server to discover its tools",
        )
            .into_response(),
    }
}

/// Build the transport for a server + run discovery. Returns the tool count, or `None` if the
/// server is `stdio` (device-only) or unreachable/errored.
async fn discover_now(
    state: &SharedState,
    server_id: Uuid,
    transport: &str,
    url: Option<&str>,
) -> Option<usize> {
    if transport == "stdio" {
        return None; // device-only — discovered on the desktop host
    }
    let url = url?;
    let filter = EgressFilter::new(StdResolver, EgressPolicy::default());
    let client = match HttpClient::connect(&filter, url, None, TOOL_TIMEOUT) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("mcp discovery: connect failed for {server_id}: {e}");
            return None;
        }
    };
    match discover_and_cache(&state.pool, server_id, &client).await {
        Ok(n) => Some(n),
        Err(e) => {
            tracing::warn!("mcp discovery: list_tools failed for {server_id}: {e}");
            None
        }
    }
}
