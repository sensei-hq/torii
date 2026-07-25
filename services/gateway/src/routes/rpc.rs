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

    audit(&state, tenant, actor, "budget.node.upserted", "budget_node", Some(id)).await;
    (StatusCode::OK, Json(json!({ "id": id }))).into_response()
}

#[derive(Deserialize)]
pub struct BudgetIncreaseRequest {
    pub node_id: Uuid,
    pub requested_cap: f64,
    #[serde(default)]
    pub reason: Option<String>,
}

/// `POST /rpc/budgets/request` — capability `budget.request`. A caller asks to raise
/// the cap on a budget node (typically their own leaf, after a 402). Records a
/// **pending** `budget_requests` row for an admin to approve via
/// `/budgets/approve-request`; it changes no cap itself. Non-privileged relative to
/// `budget.write`, so members/editors hold it while only admins/owners approve.
pub async fn budgets_request(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<BudgetIncreaseRequest>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "budget.request").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    // Insert only if the node exists in the caller's tenant (else 404) — no
    // cross-tenant request, and no cap change here (admin approval does that).
    let inserted: Result<Option<Uuid>, _> = sqlx::query_scalar(
        "insert into public.budget_requests \
           (tenant_id, node_id, requested_by, requested_cap, reason, status) \
         select $1, $2, $3, $4::numeric, $5, 'pending' \
          where exists (select 1 from public.budget_nodes b where b.tenant_id = $1 and b.id = $2) \
         returning id",
    )
    .bind(tenant)
    .bind(body.node_id)
    .bind(actor)
    .bind(body.requested_cap)
    .bind(&body.reason)
    .fetch_optional(&state.pool)
    .await;

    match inserted {
        Ok(Some(id)) => {
            audit(&state, tenant, actor, "budget.request.submitted", "budget_request", Some(id)).await;
            (StatusCode::OK, Json(json!({ "id": id, "status": "pending" }))).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, "budget node not found in tenant").into_response(),
        Err(e) => {
            tracing::error!("budgets_request: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct IssueApiKey {
    #[serde(default)]
    pub name: Option<String>,
    /// Bind the key to a service account (must be in-tenant); else the caller's identity.
    #[serde(default)]
    pub service_account_id: Option<Uuid>,
}

/// `POST /rpc/apikeys/issue` — capability `apikey.manage`. Mints an identity-bound
/// API key (`sk_str_…`), stores only the prefix + argon2id hash, and returns the raw
/// key **once**. The key carries no budget — spend accrues to the bound identity's
/// node (DECISIONS §1.2). The secret is never persisted or logged.
pub async fn apikeys_issue(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<IssueApiKey>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "apikey.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    // Bind to a service account (validated in-tenant) or, by default, the caller.
    let (profile_id, sa_id): (Option<Uuid>, Option<Uuid>) = match body.service_account_id {
        Some(sa) => {
            let ok: bool = sqlx::query_scalar(
                "select exists(select 1 from public.service_accounts where tenant_id=$1 and id=$2)",
            )
            .bind(tenant)
            .bind(sa)
            .fetch_one(&state.pool)
            .await
            .unwrap_or(false);
            if !ok {
                return (StatusCode::NOT_FOUND, "service account not found in tenant").into_response();
            }
            (None, Some(sa))
        }
        None => (Some(actor), None),
    };

    let minted = match crate::apikeys::mint() {
        Ok(m) => m,
        Err(e) => {
            tracing::error!("apikeys_issue: mint failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "mint failed").into_response();
        }
    };

    let id = Uuid::new_v4();
    let scope = json!([body.name.as_deref().unwrap_or("inference")]).to_string();
    let write = sqlx::query(
        "insert into public.api_keys \
           (tenant_id, id, profile_id, service_account_id, hashed_secret, prefix, scope, status, created_by) \
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,'active',$8)",
    )
    .bind(tenant)
    .bind(id)
    .bind(profile_id)
    .bind(sa_id)
    .bind(&minted.hashed_secret)
    .bind(&minted.prefix)
    .bind(scope)
    .bind(actor.to_string())
    .execute(&state.pool)
    .await;

    if let Err(e) = write {
        tracing::error!("apikeys_issue: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }

    audit(&state, tenant, actor, "apikey.issued", "api_key", Some(id)).await;
    // Raw key returned exactly once — the operator must copy it now.
    (
        StatusCode::OK,
        Json(json!({ "id": id, "prefix": minted.prefix, "key": minted.full })),
    )
        .into_response()
}

#[derive(Deserialize)]
pub struct ApproveRequest {
    pub id: Uuid,
}

/// `POST /rpc/budgets/approve-request` — capability `budget.write`. Applies the
/// member's requested cap to the node and marks the request approved.
pub async fn budgets_approve_request(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<ApproveRequest>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "budget.write").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let write = sqlx::query(
        "with req as ( \
           update public.budget_requests set status='approved', resolved_by=$2, resolved_at=now() \
            where tenant_id=$1 and id=$3 and status='pending' returning node_id, requested_cap) \
         update public.budget_nodes b set cap_amount = req.requested_cap, modified_at = now() \
           from req where b.tenant_id=$1 and b.id = req.node_id",
    )
    .bind(tenant)
    .bind(actor)
    .bind(body.id)
    .execute(&state.pool)
    .await;
    match write {
        Ok(r) if r.rows_affected() == 0 => (StatusCode::NOT_FOUND, "no pending request").into_response(),
        Ok(_) => {
            audit(&state, tenant, actor, "budget.request.approved", "budget_request", Some(body.id)).await;
            (StatusCode::OK, Json(json!({ "approved": body.id }))).into_response()
        }
        Err(e) => {
            tracing::error!("approve-request: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct AssignRole {
    pub profile_id: Uuid,
    pub role_id: Uuid,
}

/// `POST /rpc/rbac/assign-role` — capability `role.manage`. Assigns a role and
/// BUMPS the target's claims_version (freshness gate: existing tokens re-resolve).
pub async fn rbac_assign_role(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<AssignRole>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "role.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    // #8 target-tenant guard: the target profile must be an ACTIVE member of the
    // caller's tenant, else 404 — no cross-tenant `profile_roles` insert and (with
    // the bump below now gated on this) no cross-tenant claims_version DoS (#9).
    let member: bool = sqlx::query_scalar(
        "select exists(select 1 from core.profile_tenants \
           where profile_id = $1 and tenant_id = $2 and status = 'active')",
    )
    .bind(body.profile_id)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !member {
        return (StatusCode::NOT_FOUND, "profile not found in tenant").into_response();
    }

    // #8 role-tenant guard: the role must belong to the caller's tenant, else 404.
    let role_in_tenant: bool = sqlx::query_scalar(
        "select exists(select 1 from core.roles where id = $1 and tenant_id = $2)",
    )
    .bind(body.role_id)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !role_in_tenant {
        return (StatusCode::NOT_FOUND, "role not found in tenant").into_response();
    }

    // #3 anti-escalation subset guard: the assigned role's capabilities must be a
    // SUBSET of the ACTOR's own resolved capabilities. This blocks an admin (holds
    // `role.manage`, lacks `tenant.manage`) from granting `owner` (holds
    // `tenant.manage`) — to self or anyone — thereby escalating.
    let assigned_caps: Vec<String> = match sqlx::query_scalar(
        "select capability from core.role_permissions where role_id = $1 and tenant_id = $2",
    )
    .bind(body.role_id)
    .bind(tenant)
    .fetch_all(&state.pool)
    .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("assign-role: resolve assigned caps: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    let actor_caps = match CapabilitySet::resolve(&state.pool, &claims).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("assign-role: resolve actor caps: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    if !assigned_caps.iter().all(|c| actor_caps.has(c)) {
        return (
            StatusCode::FORBIDDEN,
            "cannot assign a role exceeding your own capabilities",
        )
            .into_response();
    }

    // Guards passed (target in-tenant, role in-tenant, no escalation) — now write.
    let assign = sqlx::query(
        "insert into core.profile_roles (tenant_id, profile_id, role_id, assigned_by) \
         values ($1,$2,$3,$4) on conflict do nothing",
    )
    .bind(tenant)
    .bind(body.profile_id)
    .bind(body.role_id)
    .bind(actor.to_string())
    .execute(&state.pool)
    .await;
    if let Err(e) = assign {
        tracing::error!("assign-role: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    // Freshness gate: invalidate the target's existing tokens (target is tenant-validated).
    let _ = sqlx::query("update core.profiles set claims_version = claims_version + 1 where id = $1")
        .bind(body.profile_id)
        .execute(&state.pool)
        .await;
    audit(&state, tenant, actor, "role.assigned", "profile_role", Some(body.profile_id)).await;
    (StatusCode::OK, Json(json!({ "assigned": body.role_id }))).into_response()
}

#[derive(Deserialize)]
pub struct SetFeature {
    pub feature_key: String,
    pub scope_type: String, // workspace | space | role
    pub scope_id: Option<Uuid>,
    pub state: String, // locked | default-on | default-off | user-overridable
}

/// `POST /rpc/governance/set-feature` — capability `feature.manage`. Upserts the
/// 4-state feature-governance policy for a feature × scope (RW6).
pub async fn governance_set_feature(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetFeature>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "feature.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let write = sqlx::query(
        "insert into public.feature_policies \
           (tenant_id, feature_key, scope_type, scope_id, state, modified_by) \
         values ($1,$2,$3,$4,$5,$6) \
         on conflict (tenant_id, feature_key, scope_type, scope_id) \
         do update set state = excluded.state, modified_by = excluded.modified_by, modified_at = now()",
    )
    .bind(tenant)
    .bind(&body.feature_key)
    .bind(&body.scope_type)
    .bind(body.scope_id)
    .bind(&body.state)
    .bind(actor.to_string())
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("set-feature: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(&state, tenant, actor, "governance.feature.set", "feature_policy", None).await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

#[derive(Deserialize)]
pub struct CreateSpace {
    pub name: String,
    pub classification: Option<String>,
}

/// `POST /rpc/spaces/create` — capability `space.create`. Creates a space owned
/// by the caller.
pub async fn spaces_create(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<CreateSpace>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "space.create").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let id = Uuid::new_v4();
    let write = sqlx::query(
        "insert into public.spaces (tenant_id, id, name, classification, owner_id, modified_by) \
         values ($1,$2,$3, coalesce($4,'confidential'), $5, $6)",
    )
    .bind(tenant)
    .bind(id)
    .bind(&body.name)
    .bind(&body.classification)
    .bind(actor)
    .bind(actor.to_string())
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("spaces_create: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(&state, tenant, actor, "space.created", "space", Some(id)).await;
    (StatusCode::OK, Json(json!({ "id": id }))).into_response()
}

/// Actor-bound audit helper (matches the RW8 with-check: actor_id = auth.uid()).
///
/// O1/#12: a privileged mutation must never silently lack its audit row. This runs
/// on autocommit after the mutation, so it cannot atomically roll the mutation back
/// on failure — but a failed audit write is now surfaced at **ERROR** (the audit's
/// stated "at minimum, emit an error-level alert" bar) so it is alertable rather than
/// silent. Full transactional mutation+audit atomicity is a tracked follow-up
/// (several handlers do multi-step writes; wrapping each in one tx is the ideal).
async fn audit(
    state: &SharedState,
    tenant: Uuid,
    actor: Uuid,
    action: &str,
    target_type: &str,
    target_id: Option<Uuid>,
) {
    if let Err(e) = sqlx::query(
        "insert into public.audit_events (tenant_id, actor_id, action, target_type, target_id) \
         values ($1, $2, $3, $4, $5)",
    )
    .bind(tenant)
    .bind(actor)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .execute(&state.pool)
    .await
    {
        tracing::error!(
            %actor, action, %tenant, error = %e,
            "AUDIT WRITE FAILED — privileged mutation committed without its audit row"
        );
    }
}
