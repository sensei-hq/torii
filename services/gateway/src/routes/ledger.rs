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
async fn require_read(state: &SharedState, claims: &Claims, capability: &str) -> Result<Uuid, Response> {
    let tenant = claims
        .tenant_id
        .ok_or_else(|| (StatusCode::FORBIDDEN, "no active tenant").into_response())?;
    check_claims_version(&state.pool, claims)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, "stale token — re-authenticate").into_response())?;
    let caps = CapabilitySet::resolve(&state.pool, claims).await.map_err(|e| {
        tracing::error!("ledger: capability resolve: {e}");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    })?;
    caps.require(capability)
        .map_err(|_| (StatusCode::FORBIDDEN, format!("missing capability {capability}")).into_response())?;
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
