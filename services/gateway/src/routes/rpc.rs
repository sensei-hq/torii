//! C1 · gateway-mediated privileged writes (`/rpc/<domain>/<action>`, DECISIONS §5a).
//!
//! The reference pattern every privileged write follows:
//!   1. freshness gate (claims_version) → 401 if stale,
//!   2. server-side capability resolution + `require(<cap>)` → 403 if missing,
//!   3. the mutation runs as the gateway's DB role (service_role/superuser →
//!      bypasses RLS; RLS + SELECT-only grants block any direct-PostgREST attempt),
//!   4. an actor-bound `audit_events` row.
//!
//! This module currently implements `budgets/upsert-node` as the canonical
//! example; the remaining /rpc domains (roles, chains, connections, governance,
//! spaces, mcp, apikeys, models) follow the same shape and land through P5.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::Claims,
    capabilities::{check_claims_version, CapabilitySet},
    state::SharedState,
};

/// Resolve capabilities + run the freshness gate, or return the mapped error
/// response. Shared preamble for every privileged handler.
async fn authorize(
    state: &SharedState,
    claims: &Claims,
    capability: &str,
) -> Result<(Uuid, Uuid), Response> {
    let tenant = claims
        .tenant_id
        .ok_or_else(|| (StatusCode::FORBIDDEN, "no active tenant").into_response())?;
    let actor = Uuid::parse_str(&claims.sub)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "bad subject").into_response())?;

    check_claims_version(&state.pool, claims)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, "stale token — re-authenticate").into_response())?;

    let caps = CapabilitySet::resolve(&state.pool, claims)
        .await
        .map_err(|e| {
            tracing::error!("capability resolve: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;
    caps.require(capability)
        .map_err(|_| (StatusCode::FORBIDDEN, format!("missing capability {capability}")).into_response())?;

    Ok((tenant, actor))
}

#[derive(Deserialize)]
pub struct UpsertNode {
    pub id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub kind: String,
    pub name: String,
    pub cap_amount: Option<f64>,
    pub period: Option<String>,
    pub enforcement: Option<String>,
}

/// `POST /rpc/budgets/upsert-node` — capability `budget.write`.
pub async fn budgets_upsert_node(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<UpsertNode>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "budget.write").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let id = body.id.unwrap_or_else(Uuid::new_v4);
    let write = sqlx::query(
        "insert into public.budget_nodes \
           (tenant_id, id, parent_id, kind, name, cap_amount, period, enforcement, modified_by) \
         values ($1,$2,$3,$4,$5,$6, coalesce($7,'monthly'), coalesce($8,'hard'), $9) \
         on conflict (tenant_id, id) do update set \
           parent_id = excluded.parent_id, kind = excluded.kind, name = excluded.name, \
           cap_amount = excluded.cap_amount, period = excluded.period, \
           enforcement = excluded.enforcement, modified_at = now(), modified_by = excluded.modified_by",
    )
    .bind(tenant)
    .bind(id)
    .bind(body.parent_id)
    .bind(&body.kind)
    .bind(&body.name)
    .bind(body.cap_amount)
    .bind(&body.period)
    .bind(&body.enforcement)
    .bind(actor.to_string())
    .execute(&state.pool)
    .await;

    if let Err(e) = write {
        tracing::error!("budgets_upsert_node: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }

    // Actor-bound audit (matches the RW8 with-check).
    let _ = sqlx::query(
        "insert into public.audit_events (tenant_id, actor_id, action, target_type, target_id) \
         values ($1, $2, 'budget.node.upserted', 'budget_node', $3)",
    )
    .bind(tenant)
    .bind(actor)
    .bind(id)
    .execute(&state.pool)
    .await;

    (StatusCode::OK, Json(json!({ "id": id }))).into_response()
}
