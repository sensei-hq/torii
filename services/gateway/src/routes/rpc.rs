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
    caps.require(capability).map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            format!("missing capability {capability}"),
        )
            .into_response()
    })?;

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

    audit(
        &state,
        tenant,
        actor,
        "budget.node.upserted",
        "budget_node",
        Some(id),
    )
    .await;
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
            audit(
                &state,
                tenant,
                actor,
                "budget.request.submitted",
                "budget_request",
                Some(id),
            )
            .await;
            (
                StatusCode::OK,
                Json(json!({ "id": id, "status": "pending" })),
            )
                .into_response()
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
                return (StatusCode::NOT_FOUND, "service account not found in tenant")
                    .into_response();
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
pub struct RevokeApiKey {
    pub id: Uuid,
}

/// `POST /rpc/apikeys/revoke` — capability `apikey.manage`. Sets the key's status to
/// `revoked`; it stops authenticating **immediately** (auth.rs denies any non-active
/// status at the boundary). Tenant-scoped — a token can only revoke its own tenant's
/// keys (404 otherwise) — and idempotent (re-revoking is a no-op).
pub async fn apikeys_revoke(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<RevokeApiKey>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "apikey.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    // The key must belong to the caller's tenant (else 404 — no cross-tenant revoke).
    let exists: bool = sqlx::query_scalar(
        "select exists(select 1 from public.api_keys where id = $1 and tenant_id = $2)",
    )
    .bind(body.id)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !exists {
        return (StatusCode::NOT_FOUND, "api key not found in tenant").into_response();
    }

    let write = sqlx::query(
        "update public.api_keys set status = 'revoked' where id = $1 and tenant_id = $2",
    )
    .bind(body.id)
    .bind(tenant)
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("apikeys_revoke: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "apikey.revoked",
        "api_key",
        Some(body.id),
    )
    .await;
    (StatusCode::OK, Json(json!({ "revoked": body.id }))).into_response()
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
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, "no pending request").into_response()
        }
        Ok(_) => {
            audit(
                &state,
                tenant,
                actor,
                "budget.request.approved",
                "budget_request",
                Some(body.id),
            )
            .await;
            (StatusCode::OK, Json(json!({ "approved": body.id }))).into_response()
        }
        Err(e) => {
            tracing::error!("approve-request: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response()
        }
    }
}

/// `POST /rpc/budgets/deny-request` — capability `budget.write`. Marks a pending
/// request denied (no cap change).
pub async fn budgets_deny_request(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<ApproveRequest>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "budget.write").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let write = sqlx::query(
        "update public.budget_requests set status='denied', resolved_by=$2, resolved_at=now() \
          where tenant_id=$1 and id=$3 and status='pending'",
    )
    .bind(tenant)
    .bind(actor)
    .bind(body.id)
    .execute(&state.pool)
    .await;
    match write {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, "no pending request").into_response()
        }
        Ok(_) => {
            audit(
                &state,
                tenant,
                actor,
                "budget.request.denied",
                "budget_request",
                Some(body.id),
            )
            .await;
            (StatusCode::OK, Json(json!({ "denied": body.id }))).into_response()
        }
        Err(e) => {
            tracing::error!("deny-request: {e}");
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
    let _ =
        sqlx::query("update core.profiles set claims_version = claims_version + 1 where id = $1")
            .bind(body.profile_id)
            .execute(&state.pool)
            .await;
    audit(
        &state,
        tenant,
        actor,
        "role.assigned",
        "profile_role",
        Some(body.profile_id),
    )
    .await;
    (StatusCode::OK, Json(json!({ "assigned": body.role_id }))).into_response()
}

#[derive(Deserialize)]
pub struct UnassignRole {
    pub profile_id: Uuid,
    pub role_id: Uuid,
}

/// `POST /rpc/rbac/unassign-role` — capability `role.manage`. Removes a role and
/// BUMPS the target's claims_version. Guarded like assign (target + role in-tenant,
/// anti-escalation subset — you can't strip a role whose caps exceed your own) PLUS a
/// last-owner guard: the removal must not leave the tenant with zero members holding
/// `tenant.manage` (no orphaning the org).
pub async fn rbac_unassign_role(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<UnassignRole>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "role.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    // target must be an ACTIVE member of the caller's tenant (else 404 — no
    // cross-tenant delete + no cross-tenant claims_version DoS).
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

    // role must belong to the caller's tenant (else 404).
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

    // anti-escalation subset guard: the REMOVED role's capabilities must be a subset
    // of the ACTOR's own — blocks an admin (role.manage, no tenant.manage) from
    // stripping an owner's `owner` role.
    let removed_caps: Vec<String> = match sqlx::query_scalar(
        "select capability from core.role_permissions where role_id = $1 and tenant_id = $2",
    )
    .bind(body.role_id)
    .bind(tenant)
    .fetch_all(&state.pool)
    .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("unassign-role: resolve removed caps: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    let actor_caps = match CapabilitySet::resolve(&state.pool, &claims).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("unassign-role: resolve actor caps: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    if !removed_caps.iter().all(|c| actor_caps.has(c)) {
        return (
            StatusCode::FORBIDDEN,
            "cannot remove a role exceeding your own capabilities",
        )
            .into_response();
    }

    // last-owner guard: the removal must not leave the tenant with zero members
    // holding `tenant.manage`. Counts distinct owners AFTER hypothetically removing
    // this (profile, role) row — correctly keeps the target if they hold it via
    // another role, or another member holds it.
    let owners_after: i64 = sqlx::query_scalar(
        "select count(distinct pr.profile_id) \
           from core.profile_roles pr \
           join core.role_permissions rp \
             on rp.role_id = pr.role_id and rp.tenant_id = pr.tenant_id \
          where pr.tenant_id = $1 and rp.capability = 'tenant.manage' \
            and not (pr.profile_id = $2 and pr.role_id = $3)",
    )
    .bind(tenant)
    .bind(body.profile_id)
    .bind(body.role_id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);
    if owners_after == 0 {
        return (
            StatusCode::CONFLICT,
            "cannot remove the last owner of the tenant",
        )
            .into_response();
    }

    // Guards passed — remove the grant.
    let del = sqlx::query(
        "delete from core.profile_roles where tenant_id = $1 and profile_id = $2 and role_id = $3",
    )
    .bind(tenant)
    .bind(body.profile_id)
    .bind(body.role_id)
    .execute(&state.pool)
    .await;
    if let Err(e) = del {
        tracing::error!("unassign-role: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    // Freshness gate: invalidate the target's existing tokens (target is tenant-validated).
    let _ =
        sqlx::query("update core.profiles set claims_version = claims_version + 1 where id = $1")
            .bind(body.profile_id)
            .execute(&state.pool)
            .await;
    audit(
        &state,
        tenant,
        actor,
        "role.unassigned",
        "profile_role",
        Some(body.profile_id),
    )
    .await;
    (StatusCode::OK, Json(json!({ "unassigned": body.role_id }))).into_response()
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
    // Delete-then-insert (idempotent). `on conflict` is unreliable here because a
    // workspace-scope policy has scope_id NULL, and Postgres treats NULLs as DISTINCT in
    // the unique index — so ON CONFLICT never fires and rows accumulate. `is not distinct
    // from` matches the NULL correctly.
    let write = async {
        let mut tx = state.pool.begin().await?;
        sqlx::query(
            "delete from public.feature_policies \
              where tenant_id = $1 and feature_key = $2 and scope_type = $3 \
                and scope_id is not distinct from $4",
        )
        .bind(tenant)
        .bind(&body.feature_key)
        .bind(&body.scope_type)
        .bind(body.scope_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "insert into public.feature_policies \
               (tenant_id, feature_key, scope_type, scope_id, state, modified_by) \
             values ($1,$2,$3,$4,$5,$6)",
        )
        .bind(tenant)
        .bind(&body.feature_key)
        .bind(&body.scope_type)
        .bind(body.scope_id)
        .bind(&body.state)
        .bind(actor.to_string())
        .execute(&mut *tx)
        .await?;
        tx.commit().await
    }
    .await;
    if let Err(e) = write {
        tracing::error!("set-feature: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "governance.feature.set",
        "feature_policy",
        None,
    )
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

#[derive(Deserialize)]
pub struct SetModelEnabled {
    pub model_full_name: String,
    pub enabled: bool,
}

/// `POST /rpc/models/set-enabled` — enable/disable a model for the tenant (absent row =
/// enabled). Capability `model.manage`. pk is (tenant, model) so ON CONFLICT is exact.
pub async fn models_set_enabled(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetModelEnabled>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "model.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let write = sqlx::query(
        "insert into public.tenant_model_state (tenant_id, model_full_name, enabled, modified_by) \
         values ($1,$2,$3,$4) \
         on conflict (tenant_id, model_full_name) \
         do update set enabled = excluded.enabled, modified_by = excluded.modified_by, modified_at = now()",
    )
    .bind(tenant)
    .bind(&body.model_full_name)
    .bind(body.enabled)
    .bind(actor.to_string())
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("models_set_enabled: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "model.enabled.set",
        "tenant_model_state",
        None,
    )
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

#[derive(Deserialize)]
pub struct SetChainStep {
    pub id: Uuid,
    pub is_active: bool,
}

/// `POST /rpc/routing/set-step-active` — enable/disable one fallback-chain step (the
/// gateway skips inactive steps when resolving a chain). Capability `chain.write`.
pub async fn routing_set_step(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetChainStep>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "chain.write").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let write = sqlx::query(
        "update public.fallback_chain_models \
            set is_active = $1, modified_by = $2, modified_at = now() \
          where id = $3 and tenant_id = $4",
    )
    .bind(body.is_active)
    .bind(actor.to_string())
    .bind(body.id)
    .bind(tenant)
    .execute(&state.pool)
    .await;
    match write {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, "step not found in tenant").into_response()
        }
        Ok(_) => {
            audit(
                &state,
                tenant,
                actor,
                "routing.step.set",
                "fallback_chain_model",
                Some(body.id),
            )
            .await;
            (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
        }
        Err(e) => {
            tracing::error!("routing_set_step: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response()
        }
    }
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

#[derive(Deserialize)]
pub struct SetSetting {
    pub setting_key: String,
    pub enabled: bool,
}

/// `POST /rpc/settings/set` — set a workspace-default policy toggle. Capability
/// `tenant.manage`. pk is (tenant, setting_key) so ON CONFLICT is exact.
pub async fn settings_set(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetSetting>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "tenant.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let write = sqlx::query(
        "insert into public.tenant_settings (tenant_id, setting_key, enabled, modified_by) \
         values ($1,$2,$3,$4) \
         on conflict (tenant_id, setting_key) \
         do update set enabled = excluded.enabled, modified_by = excluded.modified_by, modified_at = now()",
    )
    .bind(tenant)
    .bind(&body.setting_key)
    .bind(body.enabled)
    .bind(actor.to_string())
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("settings_set: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "settings.set",
        "tenant_settings",
        None,
    )
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

#[derive(Deserialize)]
pub struct SetMcpEnabled {
    pub mcp_server_id: Uuid,
    pub enabled: bool,
}

/// `POST /rpc/mcp/set-enabled` — capability `mcp.manage`. Enables/disables an MCP
/// server for the tenant (upserts tenant_mcp_servers). The server must be visible to
/// the caller's tenant (platform-scoped or own) else 404.
pub async fn mcp_set_enabled(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetMcpEnabled>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "mcp.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let visible: bool = sqlx::query_scalar(
        "select exists(select 1 from public.mcp_servers \
           where id = $1 and (scope = 'platform' or tenant_id = $2))",
    )
    .bind(body.mcp_server_id)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !visible {
        return (StatusCode::NOT_FOUND, "mcp server not found").into_response();
    }
    let write = sqlx::query(
        "insert into public.tenant_mcp_servers (tenant_id, mcp_server_id, enabled) \
         values ($1,$2,$3) \
         on conflict (tenant_id, mcp_server_id) do update set enabled = excluded.enabled",
    )
    .bind(tenant)
    .bind(body.mcp_server_id)
    .bind(body.enabled)
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("mcp_set_enabled: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "mcp.server.set",
        "mcp_server",
        Some(body.mcp_server_id),
    )
    .await;
    (StatusCode::OK, Json(json!({ "enabled": body.enabled }))).into_response()
}

#[derive(Deserialize)]
pub struct SetToolGrant {
    pub role_id: Uuid,
    pub mcp_server_id: Uuid,
    pub tool_name: String,
    pub allowed: bool,
}

/// `POST /rpc/mcp/set-tool-grant` — capability `mcp.manage`. Sets the ROLE-DEFAULT
/// (space_id null) allow-list grant for (role, server, tool). Default-deny: `allowed`
/// adds the grant (idempotent, no dup), else it's removed. Guards: role in-tenant, and
/// the tool must exist on a server visible to the tenant.
pub async fn mcp_set_tool_grant(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetToolGrant>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "mcp.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let role_ok: bool = sqlx::query_scalar(
        "select exists(select 1 from core.roles where id = $1 and tenant_id = $2)",
    )
    .bind(body.role_id)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !role_ok {
        return (StatusCode::NOT_FOUND, "role not found in tenant").into_response();
    }
    let tool_ok: bool = sqlx::query_scalar(
        "select exists(select 1 from public.mcp_server_tools mt \
           join public.mcp_servers s on s.id = mt.mcp_server_id \
          where mt.mcp_server_id = $1 and mt.tool_name = $2 \
            and (s.scope = 'platform' or s.tenant_id = $3))",
    )
    .bind(body.mcp_server_id)
    .bind(&body.tool_name)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !tool_ok {
        return (StatusCode::NOT_FOUND, "tool not found on a visible server").into_response();
    }
    // No natural-key unique constraint on tool_allow_lists → conditional insert / delete.
    let write = if body.allowed {
        sqlx::query(
            "insert into public.tool_allow_lists (tenant_id, role_id, space_id, mcp_server_id, tool_name) \
             select $1,$2,null,$3,$4 where not exists ( \
               select 1 from public.tool_allow_lists \
                where tenant_id=$1 and role_id=$2 and space_id is null \
                  and mcp_server_id=$3 and tool_name=$4)",
        )
    } else {
        sqlx::query(
            "delete from public.tool_allow_lists \
              where tenant_id=$1 and role_id=$2 and space_id is null \
                and mcp_server_id=$3 and tool_name=$4",
        )
    }
    .bind(tenant)
    .bind(body.role_id)
    .bind(body.mcp_server_id)
    .bind(&body.tool_name)
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("mcp_set_tool_grant: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "mcp.tool.grant.set",
        "tool_allow_list",
        Some(body.role_id),
    )
    .await;
    (
        StatusCode::OK,
        Json(json!({ "role_id": body.role_id, "tool_name": body.tool_name, "allowed": body.allowed })),
    )
        .into_response()
}

#[derive(Deserialize)]
pub struct RevokeDevice {
    pub id: Uuid,
}

/// `POST /rpc/devices/revoke` — capability `device.manage`. Sets a device's status to
/// `revoked`; its requests are denied on the auth hot path immediately (auth::finish_authed),
/// so a revoked device cannot keep spending even with a still-live JWT. Tenant-scoped
/// (404 if the device isn't in the caller's tenant), idempotent, audited.
pub async fn devices_revoke(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<RevokeDevice>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "device.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let exists: bool = sqlx::query_scalar(
        "select exists(select 1 from public.devices where id = $1 and tenant_id = $2)",
    )
    .bind(body.id)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !exists {
        return (StatusCode::NOT_FOUND, "device not found in tenant").into_response();
    }
    let write = sqlx::query(
        "update public.devices set status = 'revoked' where id = $1 and tenant_id = $2",
    )
    .bind(body.id)
    .bind(tenant)
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("devices_revoke: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "device.revoked",
        "device",
        Some(body.id),
    )
    .await;
    (StatusCode::OK, Json(json!({ "revoked": body.id }))).into_response()
}

#[derive(Deserialize)]
pub struct ConnectRouter {
    /// Router NAME (`config.routers.name`), e.g. "openai".
    pub router: String,
    /// The BYOK provider secret — WRITE-ONLY: sealed at rest, never returned/logged.
    pub key: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Deserialize)]
pub struct RevokeRouter {
    pub router: String,
}

/// Resolve a router NAME to its id (routers are platform config, not tenant-scoped).
/// 404 if unknown.
async fn resolve_router_id(state: &SharedState, name: &str) -> Result<Uuid, Response> {
    sqlx::query_scalar::<_, Uuid>("select id from config.routers where name = $1")
        .bind(name)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("resolve_router_id: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "router not found").into_response())
}

/// Shared connect/rotate: both seal + upsert the tenant's active BYOK key for the
/// router (one row per `(tenant, router)`). Identical server-side; distinct audit.
async fn connect_or_rotate(
    state: &SharedState,
    claims: &Claims,
    body: ConnectRouter,
    action: &str,
) -> Response {
    let (tenant, actor) = match authorize(state, claims, "connection.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let router_id = match resolve_router_id(state, &body.router).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    match state
        .tenant_keys
        .store(
            tenant,
            router_id,
            body.label.as_deref(),
            &body.key,
            &actor.to_string(),
        )
        .await
    {
        Ok(id) => {
            audit(state, tenant, actor, action, "router_key", Some(id)).await;
            (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
        }
        Err(e) => {
            tracing::error!("connections {action}: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response()
        }
    }
}

/// `POST /rpc/connections/connect` — capability `connection.manage`. Seals the
/// provided provider key under the tenant DEK and stores it as the active BYOK
/// credential for the router. The key is never returned or logged.
pub async fn connections_connect(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<ConnectRouter>,
) -> Response {
    connect_or_rotate(&state, &claims, body, "connection.connected").await
}

/// `POST /rpc/connections/rotate` — capability `connection.manage`. Replaces the
/// stored key in place (same row); reactivates it if it had been revoked.
pub async fn connections_rotate(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<ConnectRouter>,
) -> Response {
    connect_or_rotate(&state, &claims, body, "connection.rotated").await
}

/// `POST /rpc/connections/revoke` — capability `connection.manage`. Deactivates the
/// stored BYOK key for the router; resolution then falls back to the platform key.
pub async fn connections_revoke(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<RevokeRouter>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "connection.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let router_id = match resolve_router_id(&state, &body.router).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if let Err(e) = state
        .tenant_keys
        .revoke(tenant, router_id, &actor.to_string())
        .await
    {
        tracing::error!("connections revoke: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "connection.revoked",
        "router_key",
        None,
    )
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

#[derive(Deserialize)]
pub struct OAuthConnect {
    /// Router NAME (`config.routers.name`) — Anthropic in v1 (the only OAuth-capable adapter).
    pub router: String,
    /// The OAuth bearer / `setup-token` — WRITE-ONLY: sealed at rest, never returned/logged.
    pub token: String,
}

/// `POST /rpc/connections/oauth-connect` — capability `connection.manage`. Seals a pasted OAuth
/// bearer token (Anthropic `setup-token`, the ToS-safe path — no redirect) as the active
/// `credential_type='oauth'` credential for the router; an api_key credential for the same
/// router can coexist. The token is never returned or logged. (O-3a.)
pub async fn connections_oauth_connect(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<OAuthConnect>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "connection.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let router_id = match resolve_router_id(&state, &body.router).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    match state
        .tenant_keys
        .store_oauth(
            tenant,
            router_id,
            &body.token,
            None,
            None,
            None,
            None,
            &actor.to_string(),
        )
        .await
    {
        Ok(id) => {
            audit(
                &state,
                tenant,
                actor,
                "connection.oauth_connected",
                "router_credential",
                Some(id),
            )
            .await;
            (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
        }
        Err(e) => {
            tracing::error!("connections oauth-connect: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response()
        }
    }
}

/// `POST /rpc/connections/oauth-revoke` — capability `connection.manage`. Deactivates the
/// tenant's OAuth credential for the router (independent of any api_key credential). (O-3a.)
pub async fn connections_oauth_revoke(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<RevokeRouter>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "connection.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let router_id = match resolve_router_id(&state, &body.router).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if let Err(e) = state
        .tenant_keys
        .revoke_oauth(tenant, router_id, &actor.to_string())
        .await
    {
        tracing::error!("connections oauth-revoke: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "connection.oauth_revoked",
        "router_credential",
        None,
    )
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}
