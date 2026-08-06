//! O1 (P6) · capability-gated ledger read surface.
//!
//! `GET /v1/audit`    — the actor-bound audit ledger (capability `audit.read`).
//! `GET /v1/requests` — the inference-call ledger with node attribution + cost
//!                       (capability `audit.read`).
//!
//! Both are tenant-scoped server-side (the gateway runs as the superuser role, so we
//! filter by the token's `tenant_id` explicitly rather than relying on RLS) and gated
//! on a resolved capability + the claims-version freshness gate — the uniform authz
//! posture (DECISIONS §5a; a member's own self-Activity read may go direct-PostgREST
//! under RLS, a later surface).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use chrono::Utc;
use gateway::store::GatewayStore;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::Claims,
    capabilities::{check_claims_version, CapabilitySet},
    state::SharedState,
    store::PgGatewayStore,
};

/// Freshness gate + capability check for a read; returns the caller's tenant.
async fn require_read(
    state: &SharedState,
    claims: &Claims,
    capability: &str,
) -> Result<Uuid, Response> {
    let tenant = claims
        .tenant_id
        .ok_or_else(|| (StatusCode::FORBIDDEN, "no active tenant").into_response())?;
    check_claims_version(&state.pool, claims)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, "stale token — re-authenticate").into_response())?;
    let caps = CapabilitySet::resolve(&state.pool, claims)
        .await
        .map_err(|e| {
            tracing::error!("ledger: capability resolve: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;
    caps.require(capability).map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            format!("missing capability {capability}"),
        )
            .into_response()
    })?;
    Ok(tenant)
}

/// Member-accessible tenant resolution — the same freshness gate as `require_read` but no
/// specific capability. For reads any authenticated member may perform (e.g. the list of
/// models they are allowed to call), as opposed to the admin management views.
async fn require_member(state: &SharedState, claims: &Claims) -> Result<Uuid, Response> {
    let tenant = claims
        .tenant_id
        .ok_or_else(|| (StatusCode::FORBIDDEN, "no active tenant").into_response())?;
    check_claims_version(&state.pool, claims)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, "stale token — re-authenticate").into_response())?;
    Ok(tenant)
}

#[derive(Deserialize)]
pub struct Paging {
    #[serde(default)]
    pub limit: Option<i64>,
}

fn clamp_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(100).clamp(1, 500)
}

/// `GET /v1/audit?limit=N` — recent audit events for the caller's tenant.
pub async fn get_audit(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(p): Query<Paging>,
) -> Response {
    let tenant = match require_read(&state, &claims, "audit.read").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    // Build the JSON array in-DB (avoids per-row mapping); tenant-scoped + capped.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from ( \
           select id, actor_id, action, target_type, target_id, created_at \
             from audit.audit_events_for_tenant where tenant_id = $1 \
            order by created_at desc limit $2) t",
    )
    .bind(tenant)
    .bind(clamp_limit(p.limit))
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(events) => (StatusCode::OK, Json(json!({ "events": events }))).into_response(),
        Err(e) => {
            tracing::error!("get_audit: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/requests?limit=N` — recent inference calls (cost/latency/attribution).
pub async fn get_requests(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(p): Query<Paging>,
) -> Response {
    let tenant = match require_read(&state, &claims, "audit.read").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.recorded_at desc), '[]'::json) from ( \
           select id, chain_id, adapter, model, budget_node_id, execution_location, \
                  input_tokens, output_tokens, cost_usd::float8 as cost_usd, \
                  duration_ms, status, fallback_sequence, recorded_at \
             from metering.requests_ledger_for_tenant where tenant_id = $1 \
            order by recorded_at desc limit $2) t",
    )
    .bind(tenant)
    .bind(clamp_limit(p.limit))
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(requests) => (StatusCode::OK, Json(json!({ "requests": requests }))).into_response(),
        Err(e) => {
            tracing::error!("get_requests: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/requests/{id}/trace` — the per-call routing trace for one inference call: the
/// ordered attempt chain (adapter → model, status, duration, and the error that triggered
/// each fallback) that explains WHY a given model answered. Capability `audit.read`; the
/// store filters by the caller's tenant, so one tenant can never read another's trace.
/// Returns `{ "trace": null }` when no trace was recorded for the id (calls that predate
/// the trace write, or a best-effort trace write that failed) — never a 404 for a real row.
pub async fn get_request_trace(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Response {
    let tenant = match require_read(&state, &claims, "audit.read").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let store = PgGatewayStore {
        pool: state.pool.clone(),
        tenant_id: tenant,
    };
    match store.get_traces_by_call(id).await {
        // Rows come back recorded_at ASC; there is one trace per call today, so the last is
        // the most recent. `pop()` yields None (→ null) when the call has no trace.
        Ok(mut traces) => {
            let trace = traces.pop().map(|t| t.trace);
            (StatusCode::OK, Json(json!({ "trace": trace }))).into_response()
        }
        Err(e) => {
            tracing::error!("get_request_trace: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/budgets` — the tenant's budget tree (cap/spent/reserved per node) + its
/// pending increase requests (capability `budget.read`).
pub async fn get_budgets(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "budget.read").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let nodes: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.kind), '[]'::json) from ( \
           select id, parent_id, kind, name, \
                  cap_amount::float8 as cap_amount, spent_amount::float8 as spent_amount, \
                  reserved_amount::float8 as reserved_amount, enforcement, period, \
                  alert_threshold::float8 as alert_threshold, free_floor_enabled \
             from governance.budget_tree_for_tenant where tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    let requests: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from ( \
           select id, node_id, requested_by, requested_cap::float8 as requested_cap, \
                  reason, status, created_at \
             from governance.budget_requests_for_tenant where tenant_id = $1 and status = 'pending') t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match (nodes, requests) {
        (Ok(nodes), Ok(requests)) => (
            StatusCode::OK,
            Json(json!({ "nodes": nodes, "requests": requests })),
        )
            .into_response(),
        (Err(e), _) | (_, Err(e)) => {
            tracing::error!("get_budgets: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/apikeys` — the tenant's API keys, **masked** (prefix/binding/scope/status,
/// never the secret or hash). Capability `apikey.manage`.
pub async fn get_apikeys(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "apikey.manage").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from ( \
           select id, prefix, profile_id, service_account_id, scope, status, \
                  last_used_at, created_at \
             from core.apikeys_for_tenant where tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(keys) => (StatusCode::OK, Json(json!({ "keys": keys }))).into_response(),
        Err(e) => {
            tracing::error!("get_apikeys: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// Per-tenant provider/router catalog for the Connections screen. For each router:
/// `requires_key` (needs a credential at all — keyless local routers like ollama don't),
/// `connected` (THIS tenant has an active sealed BYOK key), and `connected_at` (when it
/// was last set/rotated). There is **no** cross-tenant platform fallback: a remote router
/// the tenant hasn't connected is simply unavailable to them — so `connected` is joined
/// against the caller's tenant only, and one tenant can never observe another's key.
async fn tenant_connections(pool: &sqlx::PgPool, tenant: Uuid) -> sqlx::Result<Value> {
    // §D §B: reads through the keyvault.connections_for_tenant shield view (booleans/timestamps
    // only — ciphertext is structurally absent). The view is tenant-filtered here; json shape,
    // column order, and `order by name` are preserved so the /v1/connections payload is byte-stable
    // across the Phase 2 router_credentials → keyvault deny-all move.
    sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.name), '[]'::json) from ( \
           select name, api_base_url, is_active, requires_key, \
                  connected, connected_at, oauth_connected, oauth_connected_at \
             from keyvault.connections_for_tenant \
            where tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await
}

/// `GET /v1/connections` — the caller tenant's provider/router catalog: which routers
/// need a credential, which the tenant has connected (BYOK), and when — never the secret.
/// Capability `connection.manage`.
pub async fn get_connections(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "connection.manage").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    match tenant_connections(&state.pool, tenant).await {
        Ok(providers) => (StatusCode::OK, Json(json!({ "providers": providers }))).into_response(),
        Err(e) => {
            tracing::error!("get_connections: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/org` — the tenant's people & RBAC: members (with their role keys), roles
/// (with their granted capabilities = the permission matrix), and the closed capability
/// catalog (matrix columns). Capability `role.manage` (owner/admin only). Effective
/// capabilities are the UNION over a member's roles — resolved server-side, never from
/// the JWT.
pub async fn get_org(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "role.manage").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let members: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.display_name), '[]'::json) from ( \
           select p.id, p.display_name, u.email, \
                  coalesce(json_agg(r.key order by r.key) filter (where r.key is not null), '[]'::json) as roles \
             from core.profile_roles pr \
             join core.profiles p on p.id = pr.profile_id \
             join core.roles r on r.id = pr.role_id \
             join auth.users u on u.id = p.id \
            where pr.tenant_id = $1 \
            group by p.id, p.display_name, u.email) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    let roles: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.cap_count desc, t.name), '[]'::json) from ( \
           select r.role_id as id, r.key, r.name, r.is_system, \
                  count(rp.capability) as cap_count, \
                  coalesce(json_agg(rp.capability order by rp.capability) filter (where rp.capability is not null), '[]'::json) as capabilities \
             from core.effective_roles r \
             left join core.effective_role_permissions rp \
               on rp.role_id = r.role_id and rp.tenant_id = r.tenant_id \
            where r.tenant_id = $1 \
            group by r.role_id, r.key, r.name, r.is_system) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    let capabilities: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.domain, t.key), '[]'::json) from ( \
           select key, domain, description from core.permissions) t",
    )
    .fetch_one(&state.pool)
    .await;
    match (members, roles, capabilities) {
        (Ok(members), Ok(roles), Ok(capabilities)) => (
            StatusCode::OK,
            Json(json!({ "members": members, "roles": roles, "capabilities": capabilities })),
        )
            .into_response(),
        (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => {
            tracing::error!("get_org: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/models` — the platform model catalog (provider, context window, endpoints),
/// grouped-friendly. Global config (not tenant-scoped). Capability `model.manage`.
pub async fn get_models(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "model.manage").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    // Catalog is global (catalog.models); enablement is per-tenant and DERIVED from chain
    // membership (§D Phase 3) — a model is `enabled` iff it appears in the tenant's resolved+viable
    // chains (chains_for_tenant). `reachable` (has any endpoint) stays a separate catalog fact.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.provider, t.display_name), '[]'::json) from ( \
           select m.full_name, m.display_name, m.description, m.context_window, \
                  m.max_output_tokens, m.released_on, m.deprecated_on, \
                  coalesce(p.name, 'unknown') as provider, \
                  exists(select 1 from catalog.model_endpoints e where e.model_id = m.id) as reachable, \
                  exists(select 1 from catalog.chains_for_tenant cft \
                          where cft.tenant_id = $1 and cft.model_id = m.id) as enabled \
             from catalog.models m \
             left join catalog.providers p on p.id = m.provider_id \
            where m.deprecated_on is null) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(models) => (StatusCode::OK, Json(json!({ "models": models }))).into_response(),
        Err(e) => {
            tracing::error!("get_models: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/models/available` — the models THIS member may actually call through the
/// gateway: enabled for the tenant (workspace hasn't disabled them) AND with a configured
/// endpoint. No `model.manage` (that's the admin management view) — any authenticated
/// member sees what they can use. Powers the desktop Compare screen's cloud columns.
pub async fn get_available_models(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_member(&state, &claims).await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    // §D Phase 3: the CHAT models a member may call = the DISTINCT models in the tenant's
    // resolved+viable chains FOR THE CHAT CAPABILITY (chains_for_tenant already applies
    // tenant-override resolution + the keyless-safe key-config filter; a model reaches a chain only
    // via a configured model_endpoint, so the old endpoint EXISTS is subsumed). The capability
    // filter is preserved — this powers Compare's cloud columns, which are chat-only.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.provider, t.display_name), '[]'::json) from ( \
           select distinct cft.model_full_name as full_name, \
                  coalesce(cft.model_display_name, cft.model_full_name) as display_name, \
                  coalesce(cft.provider, 'unknown') as provider \
             from catalog.chains_for_tenant cft \
             join catalog.models m on m.id = cft.model_id \
             join catalog.capability_types c on c.id = cft.capability_id \
            where cft.tenant_id = $1 \
              and c.name = 'chat' \
              and m.deprecated_on is null) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(models) => (StatusCode::OK, Json(json!({ "models": models }))).into_response(),
        Err(e) => {
            tracing::error!("get_available_models: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/tools` — X1 Tools & MCP. Capability `mcp.manage`. Returns the MCP servers
/// visible to the tenant (platform-scoped + own), their effective enablement, the
/// discovered tools, the tenant's roles, and the ROLE-DEFAULT allow-list grants
/// (`space_id is null`) — the frontend renders the servers list + a tools×roles matrix.
pub async fn get_tools(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "mcp.manage").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let build = async {
        // servers visible to the tenant; effective enabled = tenant override else default.
        let servers: Value = sqlx::query_scalar(
            "select coalesce(json_agg(t order by t.scope, t.name), '[]'::json) from ( \
               select s.id, s.name, s.label, s.transport, s.scope, \
                      coalesce(tms.enabled, s.enabled) as enabled \
                 from device.mcp_servers s \
                 left join device.tenant_mcp_servers tms \
                   on tms.mcp_server_id = s.id and tms.tenant_id = $1 \
                where s.scope = 'platform' or s.tenant_id = $1) t",
        )
        .bind(tenant)
        .fetch_one(&state.pool)
        .await?;
        let tools: Value = sqlx::query_scalar(
            "select coalesce(json_agg(t order by t.tool_name), '[]'::json) from ( \
               select mt.id, mt.mcp_server_id, mt.tool_name \
                 from device.mcp_server_tools mt \
                 join device.mcp_servers s on s.id = mt.mcp_server_id \
                where mt.is_active and (s.scope = 'platform' or s.tenant_id = $1)) t",
        )
        .bind(tenant)
        .fetch_one(&state.pool)
        .await?;
        let roles: Value = sqlx::query_scalar(
            "select coalesce(json_agg(t order by t.name), '[]'::json) from ( \
               select role_id as id, key, name from core.effective_roles where tenant_id = $1) t",
        )
        .bind(tenant)
        .fetch_one(&state.pool)
        .await?;
        // role-default grants (space_id null); a space can only tighten these (v2 UI).
        let grants: Value = sqlx::query_scalar(
            "select coalesce(json_agg(t), '[]'::json) from ( \
               select role_id, mcp_server_id, tool_name \
                 from device.tool_allow_lists where tenant_id = $1 and space_id is null) t",
        )
        .bind(tenant)
        .fetch_one(&state.pool)
        .await?;
        Ok::<Value, sqlx::Error>(
            json!({ "servers": servers, "tools": tools, "roles": roles, "grants": grants }),
        )
    };
    match build.await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => {
            tracing::error!("get_tools: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/devices` — O3-4 device fleet read model. Any authenticated member may read;
/// without `device.manage` they see only their **own** devices, with it the whole tenant
/// fleet (mirrors the `devices_access` RLS policy — the gateway pool runs as service_role
/// and bypasses RLS, so the own-vs-manage scope is reproduced in the query). Each row
/// carries a `buffer_verdict` (O3 §3.3, NULL-safe until D4-8 populates `buffer_health`) and
/// a `drifted` flag (last-synced `config_version` vs the tenant current); the operator stale
/// threshold is surfaced once at the top level. `public_key`/token material is never
/// projected. `status='revoked'` cuts a device's access on the auth hot path
/// (auth::finish_authed) even with a still-live token; revoke it via `/rpc/devices/revoke`.
pub async fn get_devices(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_member(&state, &claims).await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let actor = match Uuid::parse_str(&claims.sub) {
        Ok(a) => a,
        Err(_) => return (StatusCode::UNAUTHORIZED, "bad subject").into_response(),
    };
    // own-vs-manage: `device.manage` → whole tenant fleet; else only the caller's devices.
    let has_manage = match CapabilitySet::resolve(&state.pool, &claims).await {
        Ok(caps) => caps.require("device.manage").is_ok(),
        Err(e) => {
            tracing::error!("get_devices: capability resolve: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let own_only: Option<Uuid> = if has_manage { None } else { Some(actor) };

    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.last_seen_at desc nulls last), '[]'::json) from ( \
           select d.id, d.name, d.platform, d.app_version, d.config_version, d.status, \
                  d.enrolled_at, d.last_seen_at, d.sync_policy, d.buffer_health, \
                  d.owner, d.tenant_config_version \
             from device.devices_for_tenant d \
            where d.tenant_id = $1 and ($2::uuid is null or d.profile_id = $2)) t",
    )
    .bind(tenant)
    .bind(own_only)
    .fetch_one(&state.pool)
    .await;

    let mut devices = match rows {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("get_devices: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    };

    // Enrich each row with the buffer-health verdict + config-drift flag. Computed in Rust so
    // the stale threshold stays an operator env constant and the logic is unit-tested
    // (crate::devices); the SQL stays the field-shape authority.
    let threshold = crate::devices::stale_threshold_s();
    let now = Utc::now();
    if let Value::Array(list) = &mut devices {
        for row in list.iter_mut() {
            let verdict = crate::devices::buffer_verdict(row.get("buffer_health"), now, threshold);
            let dv = row.get("config_version").and_then(Value::as_i64);
            let tv = row.get("tenant_config_version").and_then(Value::as_i64);
            let drifted = crate::devices::is_drifted(dv, tv);
            if let Value::Object(obj) = row {
                obj.insert("buffer_verdict".into(), Value::from(verdict));
                obj.insert("drifted".into(), Value::from(drifted));
            }
        }
    }

    (
        StatusCode::OK,
        Json(json!({ "devices": devices, "stale_threshold_s": threshold })),
    )
        .into_response()
}

/// `GET /v1/routing` — the tenant's fallback chains as ordered steps
/// (router → model, sequence, plane). Capability `chain.read`. Frontend groups by chain.
pub async fn get_routing(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "chain.read").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    // Read the BASE table (not effective_chain_models, which filters is_active=true) so
    // disabled steps are shown and can be re-enabled. Includes the step id for the toggle.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.chain_name, t.sequence_order), '[]'::json) from ( \
           select fcm.id, fc.name as chain_name, fcm.sequence_order, fcm.plane, fcm.is_active, \
                  coalesce(r.name, '—') as router, \
                  coalesce(m.full_name, '—') as model \
             from catalog.chain_models fcm \
             join catalog.chains fc on fc.id = fcm.fallback_chain_id \
             left join catalog.models m on m.id = fcm.model_id \
             left join catalog.routers r on r.id = fcm.router_id \
            where fcm.tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(steps) => (StatusCode::OK, Json(json!({ "steps": steps }))).into_response(),
        Err(e) => {
            tracing::error!("get_routing: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/governance` — the feature-governance catalog: each governed feature with its
/// default posture (enabled/mandatory) AND the tenant's workspace-scope policy override
/// (`policy_state`, null = unset → use the default). Capability `governance.manage`.
pub async fn get_governance(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "governance.manage").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    // §D Phase 4: reads through the feature_governance_for_tenant shield (governance.features ×
    // the resolved workspace feature_policies state). The shield exposes `slug` over the
    // feature_key→feature_id fold, so this read is unchanged in shape (byte-stable payload).
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.sequence), '[]'::json) from ( \
           select slug, title, description, purpose, enabled, mandatory, sequence, \
                  policy_state \
             from governance.feature_governance_for_tenant \
            where tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(features) => (StatusCode::OK, Json(json!({ "features": features }))).into_response(),
        Err(e) => {
            tracing::error!("get_governance: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/settings` — the tenant's workspace-default policy toggles (absent = app
/// default). Capability `tenant.manage`.
pub async fn get_settings(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "tenant.manage").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    // §D Phase 4: /v1/settings reads the workspace toggles via the settings_for_tenant shield
    // (governance.settings absorbed tenant_settings) — {setting_key, enabled} contract preserved.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.setting_key), '[]'::json) from ( \
           select setting_key, enabled from governance.settings_for_tenant where tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(settings) => (StatusCode::OK, Json(json!({ "settings": settings }))).into_response(),
        Err(e) => {
            tracing::error!("get_settings: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

#[cfg(test)]
mod connections_view {
    //! Hits local Supabase (55322). Ignored by default — run with:
    //!   `cargo test -p torii-gateway -- --ignored connections_view`
    use super::tenant_connections;
    use serde_json::Value;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    async fn pool() -> sqlx::PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    /// The connected flag is scoped to the caller's tenant: tenant A's BYOK key must
    /// never surface as `connected` for tenant B (the core isolation property), and a
    /// key-bearing router reports `requires_key = true`.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn connected_is_per_tenant_isolated() {
        let pool = pool().await;
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let router_id: Uuid =
            sqlx::query_scalar("select id from catalog.routers where name = 'openai'")
                .fetch_one(&pool)
                .await
                .expect("openai router seeded");

        for t in [a, b] {
            sqlx::query(
                "insert into core.tenants (id, name, slug, modified_by) \
                 values ($1, 'conn-test', $2, 'conn-test')",
            )
            .bind(t)
            .bind(format!("conn-test-{t}"))
            .execute(&pool)
            .await
            .unwrap();
        }
        // Tenant A connects a (dummy-sealed) BYOK key for openai; B connects nothing.
        sqlx::query(
            "insert into keyvault.router_credentials \
               (tenant_id, router_id, encrypted_api_key, key_label, modified_by, credential_type) \
             values ($1, $2, '\\x00'::bytea, 'byok', 'tester', 'api_key')",
        )
        .bind(a)
        .bind(router_id)
        .execute(&pool)
        .await
        .unwrap();

        let openai = |v: &Value| -> Value {
            v.as_array()
                .unwrap()
                .iter()
                .find(|r| r["name"] == "openai")
                .cloned()
                .expect("openai in catalog")
        };
        let oa = openai(&tenant_connections(&pool, a).await.unwrap());
        let ob = openai(&tenant_connections(&pool, b).await.unwrap());

        assert_eq!(oa["requires_key"], Value::Bool(true), "openai needs a key");
        assert_eq!(oa["connected"], Value::Bool(true), "A connected its key");
        assert!(!oa["connected_at"].is_null(), "connected_at is set for A");
        assert_eq!(
            ob["connected"],
            Value::Bool(false),
            "tenant B must never see A's key as connected"
        );

        // cleanup — `on delete cascade` clears router_credentials with the tenant.
        for t in [a, b] {
            sqlx::query("delete from core.tenants where id = $1")
                .bind(t)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
}

#[cfg(test)]
mod trace_roundtrip {
    //! Hits local Supabase (55322). Ignored by default — run with:
    //!   `cargo test -- --ignored trace_persists_and_is_tenant_isolated`
    use crate::store::PgGatewayStore;
    use chrono::Utc;
    use gateway::store::{CallStatus, GatewayStore, InferenceCall, StoredTrace};
    use gateway::types::capability::Capability;
    use gateway::types::trace::{Attempt, AttemptStatus, ExecutionTrace, TraceStatus};
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    async fn pool() -> sqlx::PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

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
            duration_ms: 15,
            tokens: None,
            cost: None,
            error: error.map(|e| e.to_string()),
            fallback_triggered,
        }
    }

    /// A trace persisted for a call round-trips through the live JSONB column with its attempt
    /// chain intact, is fetchable by call id via the store, and is tenant-isolated (tenant B
    /// can't read tenant A's trace) — exactly what `GET /v1/requests/{id}/trace` relies on.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn trace_persists_and_is_tenant_isolated() {
        let pool = pool().await;
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        for t in [a, b] {
            sqlx::query(
                "insert into core.tenants (id, name, slug, modified_by) \
                 values ($1, 'trace-test', $2, 'trace-test')",
            )
            .bind(t)
            .bind(format!("trace-test-{t}"))
            .execute(&pool)
            .await
            .unwrap();
        }
        let store_a = PgGatewayStore {
            pool: pool.clone(),
            tenant_id: a,
        };
        let store_b = PgGatewayStore {
            pool: pool.clone(),
            tenant_id: b,
        };

        // a real inference_call row for tenant A (subject_id None → attribution cols NULL).
        let call_id = Uuid::new_v4();
        let call = InferenceCall {
            id: call_id,
            session_id: None,
            project_id: None,
            subject_id: None,
            tier: None,
            capability: Capability::TextChat,
            chain_id: Some("chat".into()),
            adapter: "ollama".into(),
            model: "gemma2:2b".into(),
            api_model_id: Some("gemma2:2b".into()),
            input_tokens: Some(10),
            output_tokens: Some(20),
            cost_usd: 0.0,
            duration_ms: 900,
            status: CallStatus::Success,
            error_type: None,
            fallback_sequence: 2,
            recorded_at: Utc::now(),
        };
        store_a.insert_inference_call(&call).await.expect("insert call");

        let trace = ExecutionTrace {
            request_id: call_id.to_string(),
            capability: Capability::TextChat,
            status: TraceStatus::Success,
            duration_ms: 900,
            candidates: Vec::new(),
            skipped: Vec::new(),
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
            estimated_cost: None,
            actual_cost: None,
            created_at: Utc::now(),
        };
        let stored = StoredTrace {
            id: Uuid::new_v4(),
            inference_call_id: Some(call_id),
            trace,
            created_at: Utc::now(),
        };
        store_a
            .insert_execution_trace(&stored)
            .await
            .expect("insert trace");

        // tenant A reads it back with the attempt chain intact.
        let got = store_a.get_traces_by_call(call_id).await.expect("read A");
        assert_eq!(got.len(), 1, "exactly one trace for the call");
        let t = &got[0].trace;
        assert_eq!(t.attempts.len(), 2);
        assert_eq!(t.attempts[0].status, AttemptStatus::Failed);
        assert_eq!(t.attempts[0].error.as_deref(), Some("429 rate limited"));
        assert_eq!(t.attempts[1].adapter, "ollama");
        assert!(matches!(t.status, TraceStatus::Success));

        // tenant B must never see tenant A's trace (the core isolation property).
        let none = store_b.get_traces_by_call(call_id).await.expect("read B");
        assert!(none.is_empty(), "tenant B must not read tenant A's trace");

        // cleanup — `on delete cascade` clears inference_calls + execution_traces with the tenant.
        for t in [a, b] {
            sqlx::query("delete from core.tenants where id = $1")
                .bind(t)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
}
