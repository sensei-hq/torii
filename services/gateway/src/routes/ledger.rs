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

/// `GET /v1/connections` — the provider/router catalog (name, base URL, whether a
/// credential env var is configured — never the secret). Capability `connection.manage`.
pub async fn get_connections(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    if let Err(resp) = require_read(&state, &claims, "connection.manage").await {
        return resp;
    }
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.name), '[]'::json) from ( \
           select name, api_base_url, (api_key_env_var is not null) as configured, is_active \
             from config.routers) t",
    )
    .fetch_one(&state.pool)
    .await;
    match rows {
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
           select p.id, p.display_name, \
                  coalesce(json_agg(r.key order by r.key) filter (where r.key is not null), '[]'::json) as roles \
             from core.profile_roles pr \
             join core.profiles p on p.id = pr.profile_id \
             join core.roles r on r.id = pr.role_id \
            where pr.tenant_id = $1 \
            group by p.id, p.display_name) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    let roles: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.cap_count desc, t.name), '[]'::json) from ( \
           select r.id, r.key, r.name, r.is_system, \
                  count(rp.capability) as cap_count, \
                  coalesce(json_agg(rp.capability order by rp.capability) filter (where rp.capability is not null), '[]'::json) as capabilities \
             from core.roles r \
             left join core.role_permissions rp on rp.role_id = r.id \
            where r.tenant_id = $1 \
            group by r.id, r.key, r.name, r.is_system) t",
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
