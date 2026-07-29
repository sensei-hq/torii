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
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::Claims,
    capabilities::{check_claims_version, CapabilitySet},
    state::SharedState,
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
             from public.audit_events where tenant_id = $1 \
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
                  duration_ms, status, recorded_at \
             from public.inference_calls where tenant_id = $1 \
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
                  reserved_amount::float8 as reserved_amount, enforcement, period \
             from public.budget_nodes where tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    let requests: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from ( \
           select id, node_id, requested_by, requested_cap::float8 as requested_cap, \
                  reason, status, created_at \
             from public.budget_requests where tenant_id = $1 and status = 'pending') t",
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
             from public.api_keys where tenant_id = $1) t",
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
    sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.name), '[]'::json) from ( \
           select r.name, r.api_base_url, r.is_active, \
                  (r.api_key_env_var is not null) as requires_key, \
                  (k.id is not null)              as connected, \
                  k.modified_at                   as connected_at, \
                  (o.id is not null)              as oauth_connected, \
                  o.modified_at                   as oauth_connected_at \
             from config.routers r \
             left join public.router_credentials k \
               on k.router_id = r.id and k.tenant_id = $1 \
              and k.is_active = true and k.credential_type = 'api_key' \
             left join public.router_credentials o \
               on o.router_id = r.id and o.tenant_id = $1 \
              and o.is_active = true and o.credential_type = 'oauth') t",
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
           select key, domain, description from core.capabilities) t",
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
    // Catalog is global (config.models); enablement is per-tenant (tenant_model_state,
    // absent row = enabled).
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.provider, t.display_name), '[]'::json) from ( \
           select m.full_name, m.display_name, m.description, m.context_window, \
                  m.max_output_tokens, m.released_on, m.deprecated_on, \
                  coalesce(p.name, 'unknown') as provider, \
                  exists(select 1 from config.model_endpoints e where e.model_id = m.id) as reachable, \
                  coalesce(tms.enabled, true) as enabled \
             from config.models m \
             left join config.providers p on p.id = m.provider_id \
             left join public.tenant_model_state tms \
               on tms.model_full_name = m.full_name and tms.tenant_id = $1 \
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
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.provider, t.display_name), '[]'::json) from ( \
           select m.full_name, coalesce(m.display_name, m.full_name) as display_name, \
                  coalesce(p.name, 'unknown') as provider \
             from config.models m \
             left join config.providers p on p.id = m.provider_id \
             left join public.tenant_model_state tms \
               on tms.model_full_name = m.full_name and tms.tenant_id = $1 \
            where m.deprecated_on is null \
              and coalesce(tms.enabled, true) = true \
              and exists(select 1 from config.model_endpoints e where e.model_id = m.id) \
              and exists(select 1 from config.model_capabilities mc \
                           join config.capabilities c on c.id = mc.capability_id \
                          where mc.model_id = m.id and c.name = 'chat' \
                            and coalesce(mc.supported, true) = true)) t",
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
                 from public.mcp_servers s \
                 left join public.tenant_mcp_servers tms \
                   on tms.mcp_server_id = s.id and tms.tenant_id = $1 \
                where s.scope = 'platform' or s.tenant_id = $1) t",
        )
        .bind(tenant)
        .fetch_one(&state.pool)
        .await?;
        let tools: Value = sqlx::query_scalar(
            "select coalesce(json_agg(t order by t.tool_name), '[]'::json) from ( \
               select mt.id, mt.mcp_server_id, mt.tool_name \
                 from public.mcp_server_tools mt \
                 join public.mcp_servers s on s.id = mt.mcp_server_id \
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
                 from public.tool_allow_lists where tenant_id = $1 and space_id is null) t",
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

/// `GET /v1/devices` — O3 device fleet. Capability `device.manage`. The tenant's
/// enrolled devices with owner + version/liveness. `status='revoked'` cuts a device's
/// access on the auth hot path (see auth::finish_authed) even with a still-live token.
pub async fn get_devices(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "device.manage").await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.last_seen_at desc nulls last), '[]'::json) from ( \
           select d.id, d.name, d.platform, d.app_version, d.config_version, d.status, \
                  d.enrolled_at, d.last_seen_at, p.display_name as owner \
             from public.devices d \
             left join core.profiles p on p.id = d.profile_id \
            where d.tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(devices) => (StatusCode::OK, Json(json!({ "devices": devices }))).into_response(),
        Err(e) => {
            tracing::error!("get_devices: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
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
             from public.fallback_chain_models fcm \
             join public.fallback_chains fc on fc.id = fcm.fallback_chain_id \
             left join config.models m on m.id = fcm.model_id \
             left join config.routers r on r.id = fcm.router_id \
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
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.sequence), '[]'::json) from ( \
           select f.slug, f.title, f.description, f.purpose, f.enabled, f.mandatory, f.sequence, \
                  fp.state as policy_state \
             from config.features f \
             left join lateral ( \
                select state from public.feature_policies p \
                 where p.feature_key = f.slug and p.tenant_id = $1 \
                   and p.scope_type = 'workspace' and p.scope_id is null \
                 order by p.modified_at desc limit 1) fp on true) t",
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
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.setting_key), '[]'::json) from ( \
           select setting_key, enabled from public.tenant_settings where tenant_id = $1) t",
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
            sqlx::query_scalar("select id from config.routers where name = 'openai'")
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
            "insert into public.router_credentials \
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
