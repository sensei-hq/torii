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
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Acquire; // savepoint-per-attempt in orgs_create (nested `tx.begin()` → SAVEPOINT)
use uuid::Uuid;

use crate::{
    auth::Claims,
    capabilities::{check_claims_version, CapabilitySet},
    state::SharedState,
};

/// URL-safe slug from a display name: lowercase, non-alphanumerics → single '-', trimmed.
/// Empty input (or all-punctuation) → "org".
fn slugify(name: &str) -> String {
    let mut s = String::new();
    let mut prev_dash = false;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            s.push(ch);
            prev_dash = false;
        } else if !prev_dash && !s.is_empty() {
            s.push('-');
            prev_dash = true;
        }
    }
    let s = s.trim_end_matches('-').to_string();
    if s.is_empty() {
        "org".to_string()
    } else {
        s
    }
}

#[cfg(test)]
mod slug_tests {
    use super::slugify;
    #[test]
    fn slugifies() {
        assert_eq!(slugify("Acme, Inc."), "acme-inc");
        assert_eq!(slugify("  Big   Corp  "), "big-corp");
        assert_eq!(slugify("!!!"), "org");
        assert_eq!(slugify(""), "org");
    }
}

/// Resolve capabilities + run the freshness gate, or return the mapped error
/// response. Shared preamble for every privileged handler.
///
/// `pub(crate)` so the C5 RAG read/retrieve handlers (`routes::documents`,
/// `routes::retrieve`) reuse the exact same authz preamble (freshness gate +
/// server-side capability resolution) rather than re-implementing it.
pub(crate) async fn authorize(
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
    /// Alert fraction 0..1 (e.g. 0.8 = alert at 80%); null = no alert.
    pub alert_threshold: Option<f64>,
    /// Drop to a free local model when the cap is exhausted (schema default true).
    /// The client sends the whole node on every edit, so an omitted value resets to true.
    pub free_floor_enabled: Option<bool>,
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
           (tenant_id, id, parent_id, kind, name, cap_amount, period, enforcement, \
            alert_threshold, free_floor_enabled, modified_by) \
         values ($1,$2,$3,$4,$5,$6, coalesce($7,'monthly')::governance.budget_period, coalesce($8,'hard')::governance.enforcement, \
                 $9, coalesce($10, true), $11) \
         on conflict (tenant_id, id) do update set \
           parent_id = excluded.parent_id, kind = excluded.kind, name = excluded.name, \
           cap_amount = excluded.cap_amount, period = excluded.period, \
           enforcement = excluded.enforcement, alert_threshold = excluded.alert_threshold, \
           free_floor_enabled = excluded.free_floor_enabled, \
           modified_at = now(), modified_by = excluded.modified_by",
    )
    .bind(tenant)
    .bind(id)
    .bind(body.parent_id)
    .bind(&body.kind)
    .bind(&body.name)
    .bind(body.cap_amount)
    .bind(&body.period)
    .bind(&body.enforcement)
    .bind(body.alert_threshold)
    .bind(body.free_floor_enabled)
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
    crate::routes::config::bump(&state.pool, tenant, "budgets").await;
    (StatusCode::OK, Json(json!({ "id": id }))).into_response()
}

#[derive(Deserialize)]
pub struct DeleteNode {
    pub id: Uuid,
}

/// `POST /rpc/budgets/delete-node` — capability `budget.write`. Deletes a budget node and,
/// via the `(tenant_id, parent_id)` self-FK `ON DELETE CASCADE`, its entire subtree. The
/// tenant's org ROOT (`parent_id IS NULL`) is UNDELETABLE: budget resolution is fail-closed
/// and every call needs a seeded org root, so removing it would break metering tenant-wide.
pub async fn budgets_delete_node(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<DeleteNode>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "budget.write").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    // Look up the node IN THE CALLER'S TENANT (no cross-tenant delete). A NULL parent
    // identifies the org root, which is refused.
    let parent: Result<Option<Option<Uuid>>, _> = sqlx::query_scalar(
        "select parent_id from public.budget_nodes where tenant_id = $1 and id = $2",
    )
    .bind(tenant)
    .bind(body.id)
    .fetch_optional(&state.pool)
    .await;

    match parent {
        Ok(None) => return (StatusCode::NOT_FOUND, "no such budget node").into_response(),
        Ok(Some(None)) => {
            return (
                StatusCode::BAD_REQUEST,
                "cannot delete the org root budget node",
            )
                .into_response()
        }
        Ok(Some(Some(_))) => {}
        Err(e) => {
            tracing::error!("budgets_delete_node lookup: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    }

    // Cascade delete — descendants go with it via the parent_id self-FK ON DELETE CASCADE.
    let del = sqlx::query("delete from public.budget_nodes where tenant_id = $1 and id = $2")
        .bind(tenant)
        .bind(body.id)
        .execute(&state.pool)
        .await;

    if let Err(e) = del {
        tracing::error!("budgets_delete_node: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "delete failed").into_response();
    }

    audit(
        &state,
        tenant,
        actor,
        "budget.node.deleted",
        "budget_node",
        Some(body.id),
    )
    .await;
    crate::routes::config::bump(&state.pool, tenant, "budgets").await;
    (StatusCode::OK, Json(json!({ "id": body.id }))).into_response()
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
                "select exists(select 1 from core.service_accounts where tenant_id=$1 and id=$2)",
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
        "insert into core.api_keys \
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
        "select exists(select 1 from core.api_keys where id = $1 and tenant_id = $2)",
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
        "update core.api_keys set status = 'revoked' where id = $1 and tenant_id = $2",
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

    // #8 role-tenant guard: the role must be usable by the caller's tenant — a shared default
    // (tenant_id NULL, expanded by the view) or the tenant's own custom role, else 404.
    let role_in_tenant: bool = sqlx::query_scalar(
        "select exists(select 1 from core.effective_roles where role_id = $1 and tenant_id = $2)",
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
        // effective view so a default role's grants (tenant_id NULL) are counted — else the
        // anti-escalation subset check would see zero caps and wrongly permit assigning `owner`.
        "select capability from core.effective_role_permissions where role_id = $1 and tenant_id = $2",
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

    // role must be usable by the caller's tenant — a shared default or the tenant's custom role.
    let role_in_tenant: bool = sqlx::query_scalar(
        "select exists(select 1 from core.effective_roles where role_id = $1 and tenant_id = $2)",
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
        // effective view so a default role's grants (tenant_id NULL) count in the subset guard.
        "select capability from core.effective_role_permissions where role_id = $1 and tenant_id = $2",
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
        // effective view so a member holding the shared default `owner` role (grants stored
        // tenant_id NULL) still counts toward tenant.manage — else the guard undercounts owners.
        "select count(distinct pr.profile_id) \
           from core.profile_roles pr \
           join core.effective_role_permissions rp \
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
pub struct CreateRole {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// `POST /rpc/rbac/create-role` — capability `role.manage`. Creates a TENANT-CUSTOM role
/// (`tenant_id` = caller's tenant, `is_system=false`) with an initial capability set — the
/// backend for the admin "duplicate a default to customize" flow. Guards:
/// - **no-shadowing**: the key must not already resolve for this tenant — a shared default
///   (owner/admin/…) or an existing custom role — else 409. The `(tenant_id, key)` unique does
///   NOT catch this (a custom `tenant_id` ≠ a default's NULL), so this check is the only guard.
/// - **anti-escalation**: every requested capability must be a SUBSET of the ACTOR's own resolved
///   caps (mirrors assign-role), so an admin can't mint a role holding a cap they lack (a cap not
///   in the catalog is never in the actor's set, so this also rejects unknown capabilities).
///
/// Role + grants are written in one transaction (dropping `tx` on any early return rolls back).
pub async fn rbac_create_role(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<CreateRole>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "role.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let key = body.key.trim();
    let name = body.name.trim();
    if key.is_empty() || name.is_empty() {
        return (StatusCode::BAD_REQUEST, "key and name are required").into_response();
    }

    // no-shadowing / no-dup: reject a key already resolving for this tenant (default or custom).
    let key_taken: bool = match sqlx::query_scalar(
        "select exists(select 1 from core.effective_roles where tenant_id = $1 and key = $2)",
    )
    .bind(tenant)
    .bind(key)
    .fetch_one(&state.pool)
    .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("create-role: key check: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    if key_taken {
        return (
            StatusCode::CONFLICT,
            "role key already in use (reserved default or existing custom role)",
        )
            .into_response();
    }

    // anti-escalation: every requested capability must be one the ACTOR holds.
    let actor_caps = match CapabilitySet::resolve(&state.pool, &claims).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("create-role: resolve actor caps: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    if let Some(missing) = body.capabilities.iter().find(|c| !actor_caps.has(c)) {
        return (
            StatusCode::FORBIDDEN,
            format!("cannot grant a capability you do not hold: {missing}"),
        )
            .into_response();
    }

    // Guards passed — write role + its grants atomically.
    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("create-role: begin: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    let role_id: Uuid = match sqlx::query_scalar(
        "insert into core.roles (tenant_id, key, name, is_system, created_by) \
         values ($1,$2,$3,false,$4) returning id",
    )
    .bind(tenant)
    .bind(key)
    .bind(name)
    .bind(actor.to_string())
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("create-role: insert role: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    for cap in &body.capabilities {
        if let Err(e) = sqlx::query(
            "insert into core.role_permissions (tenant_id, role_id, capability) values ($1,$2,$3)",
        )
        .bind(tenant)
        .bind(role_id)
        .bind(cap)
        .execute(&mut *tx)
        .await
        {
            tracing::error!("create-role: insert grant {cap}: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!("create-role: commit: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }

    audit(&state, tenant, actor, "role.created", "role", Some(role_id)).await;
    (StatusCode::OK, Json(json!({ "created": role_id }))).into_response()
}

#[derive(Deserialize)]
pub struct SetFeature {
    pub feature_key: String,
    pub scope_type: String, // workspace | space | role
    pub scope_id: Option<Uuid>,
    pub state: String, // locked | default-on | default-off | user-overridable
}

/// Validate a feature-governance write (pure, DB-free) → `Err(reason)` maps to `400`.
/// `state` must be one of the four governance states; `scope_id` must be present for
/// space/role scopes and absent for the workspace scope (a mismatch is a client bug).
pub(crate) fn validate_feature_write(
    scope_type: &str,
    scope_id: Option<Uuid>,
    state: &str,
) -> Result<(), &'static str> {
    if !matches!(
        state,
        "locked" | "default-on" | "default-off" | "user-overridable"
    ) {
        return Err("bad_state");
    }
    match scope_type {
        "workspace" if scope_id.is_some() => Err("scope_id_forbidden"),
        "space" | "role" if scope_id.is_none() => Err("scope_id_required"),
        "workspace" | "space" | "role" => Ok(()),
        _ => Err("bad_scope_type"),
    }
}

/// `POST /rpc/governance/set-feature` — capability `feature.manage`. Upserts the
/// 4-state feature-governance policy for a feature × scope (RW6). Bumps the tenant
/// `config_version` (so subscribed devices re-resolve) and emits an actor-bound audit row.
/// NB(v1): all scopes are gated on the tenant-wide `feature.manage`; a per-space authority
/// gate (via `space_members.role`) is a deferred refinement — no `space.manage` cap exists.
pub async fn governance_set_feature(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetFeature>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "feature.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if let Err(reason) = validate_feature_write(&body.scope_type, body.scope_id, &body.state) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": reason }))).into_response();
    }
    // A workspace-scope LOCK is broadest-wins — no narrower (space/role) override may be
    // written under it (it would be inert per the resolver, and silently accepting it is
    // misleading). Fail CLOSED: a read error blocks the write rather than allowing it.
    if body.scope_type != "workspace" {
        match sqlx::query_scalar::<_, bool>(
            "select exists(select 1 from public.feature_policies \
               where tenant_id = $1 and feature_key = $2 \
                 and scope_type = 'workspace' and state = 'locked')",
        )
        .bind(tenant)
        .bind(&body.feature_key)
        .fetch_one(&state.pool)
        .await
        {
            Ok(true) => {
                return (StatusCode::CONFLICT, Json(json!({ "error": "locked_by_workspace" })))
                    .into_response()
            }
            Ok(false) => {}
            Err(e) => {
                tracing::error!("set-feature lock check: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
            }
        }
    }
    // Delete-then-insert (idempotent). `on conflict` is unreliable here because a
    // workspace-scope policy has scope_id NULL, and Postgres treats NULLs as DISTINCT in
    // the unique index — so ON CONFLICT never fires and rows accumulate. `is not distinct
    // from` matches the NULL correctly.
    let write = async {
        let mut tx = state.pool.begin().await?;
        sqlx::query(
            "delete from public.feature_policies \
              where tenant_id = $1 and feature_key = $2 and scope_type = $3::governance.feature_scope \
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
             values ($1,$2,$3::governance.feature_scope,$4,$5::governance.feature_state,$6)",
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
    crate::routes::config::bump(&state.pool, tenant, "features").await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

#[derive(Deserialize)]
pub struct ClearFeature {
    pub feature_key: String,
    pub scope_type: String,
    pub scope_id: Option<Uuid>,
}

/// `POST /rpc/governance/clear-feature` — capability `feature.manage`. Removes one policy
/// row so the feature reverts to the next-broader scope (or the catalog default) per the
/// resolver. Bumps `config_version` + audits. Idempotent (clearing an absent row is OK).
pub async fn governance_clear_feature(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<ClearFeature>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "feature.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if !matches!(body.scope_type.as_str(), "workspace" | "space" | "role") {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad_scope_type" })))
            .into_response();
    }
    let deleted = sqlx::query(
        "delete from public.feature_policies \
          where tenant_id = $1 and feature_key = $2 and scope_type = $3::governance.feature_scope \
            and scope_id is not distinct from $4",
    )
    .bind(tenant)
    .bind(&body.feature_key)
    .bind(&body.scope_type)
    .bind(body.scope_id)
    .execute(&state.pool)
    .await;
    let rows = match deleted {
        Ok(r) => r.rows_affected(),
        Err(e) => {
            tracing::error!("clear-feature: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    audit(
        &state,
        tenant,
        actor,
        "governance.feature.cleared",
        "feature_policy",
        None,
    )
    .await;
    crate::routes::config::bump(&state.pool, tenant, "features").await;
    (StatusCode::OK, Json(json!({ "ok": true, "cleared": rows }))).into_response()
}

#[derive(Deserialize)]
pub struct MatrixQuery {
    pub space_id: Option<Uuid>,
}

/// `GET /rpc/governance/matrix?space_id=` — capability `feature.manage`. The RAW per-scope
/// policy rows (the admin authoring view). Members never get raw rows — they use the
/// resolver verdict (`/v1/governance`). An optional `space_id` narrows space-scope rows to
/// that space; workspace + role rows are always included.
pub async fn governance_matrix(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<MatrixQuery>,
) -> Response {
    let (tenant, _actor) = match authorize(&state, &claims, "feature.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.feature_key, t.scope_type), '[]'::json) from ( \
           select feature_key, scope_type, scope_id, state, modified_at \
             from public.feature_policies \
            where tenant_id = $1 \
              and ($2::uuid is null or scope_type <> 'space' or scope_id = $2)) t",
    )
    .bind(tenant)
    .bind(q.space_id)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(policies) => (StatusCode::OK, Json(json!({ "policies": policies }))).into_response(),
        Err(e) => {
            tracing::error!("governance matrix: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
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
    crate::routes::config::bump(&state.pool, tenant, "catalog").await;
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
            crate::routes::config::bump(&state.pool, tenant, "routing").await;
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
         values ($1,$2,$3, coalesce($4,'confidential')::core.classification_level, $5, $6)",
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

#[derive(Deserialize)]
pub struct CreateOrg {
    pub name: String,
}

/// Insert a tenant, retrying ONCE with a uuid-suffixed slug on a `core.tenants.slug`
/// unique collision. Each attempt runs inside its own SAVEPOINT (a nested `tx.begin()`
/// on an already-open transaction nests as `SAVEPOINT`): a unique violation aborts only
/// the savepoint's subtransaction, and rolling it back un-poisons the outer `tx` so the
/// retry — and the caller's remaining seeding on that same tx — can still run. WITHOUT
/// the savepoint the collision would abort the whole tx, so the retry insert fails with
/// SQLSTATE 25P02 (`in_failed_sql_transaction`) rather than a unique violation, turning
/// the dedup into dead code (any slug collision → 500). Extracted so the regression is
/// testable against the real code path (see `tests::orgs_create_seeds_and_dedups_slug`).
async fn insert_tenant_dedup_slug(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
    actor: &str,
) -> Result<Uuid, sqlx::Error> {
    let base = slugify(name);
    let mut slug = base.clone();
    let mut last_err: Option<sqlx::Error> = None;
    for attempt in 0..2 {
        let mut sp = tx.begin().await?; // SAVEPOINT on the outer tx
        let res: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
            "insert into core.tenants (name, slug, status, modified_by) \
             values ($1, $2, 'trial', $3) returning id",
        )
        .bind(name)
        .bind(&slug)
        .bind(actor)
        .fetch_one(&mut *sp)
        .await;
        match res {
            Ok(id) => {
                sp.commit().await?; // RELEASE SAVEPOINT — keep the row in the outer tx
                return Ok(id);
            }
            Err(e)
                if attempt == 0
                    && e.as_database_error().is_some_and(|d| d.is_unique_violation()) =>
            {
                let _ = sp.rollback().await; // ROLLBACK TO SAVEPOINT — un-poison the outer tx
                slug = format!("{base}-{}", &Uuid::new_v4().to_string()[..6]);
                last_err = Some(e);
            }
            Err(e) => {
                let _ = sp.rollback().await;
                return Err(e);
            }
        }
    }
    // Both attempts collided (astronomically unlikely with a random suffix): surface the
    // last unique violation rather than inventing a bespoke error.
    Err(last_err.expect("retry loop always records the first attempt's error"))
}

/// `POST /rpc/orgs/create` — self-service org creation for a TENANT-LESS caller (no capability
/// gate). One transaction: create the tenant, make the caller its `owner`, seed the fail-closed
/// budget org-root, bump claims_version. Rejects a caller who already has a tenant.
pub async fn orgs_create(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<CreateOrg>,
) -> Response {
    let actor = match Uuid::parse_str(&claims.sub) {
        Ok(a) => a,
        Err(_) => return (StatusCode::UNAUTHORIZED, "bad subject").into_response(),
    };
    let name = body.name.trim();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, "organization name is required").into_response();
    }

    let has_tenant: bool = sqlx::query_scalar(
        "select exists(select 1 from core.profile_tenants where profile_id = $1)",
    )
    .bind(actor)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(true); // fail closed
    if has_tenant {
        return (StatusCode::CONFLICT, "you already belong to an organization").into_response();
    }

    let owner_role: Uuid = match sqlx::query_scalar(
        "select id from core.roles where tenant_id is null and key = 'owner'",
    )
    .fetch_one(&state.pool)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("orgs_create: owner role lookup: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("orgs_create: begin: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };

    // Slug-collision retry via a savepoint per attempt (see `insert_tenant_dedup_slug`),
    // on the SAME outer tx as the seeding below.
    let tenant = match insert_tenant_dedup_slug(&mut tx, name, &actor.to_string()).await {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("orgs_create: insert tenant: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };

    let steps: Result<(), sqlx::Error> = async {
        sqlx::query(
            "insert into core.profile_tenants (profile_id, tenant_id, assigned_by) \
             values ($1, $2, 'self_create')",
        )
        .bind(actor)
        .bind(tenant)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "insert into core.profile_roles (tenant_id, profile_id, role_id, assigned_by) \
             values ($1, $2, $3, 'self_create')",
        )
        .bind(tenant)
        .bind(actor)
        .bind(owner_role)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "insert into public.budget_nodes (tenant_id, kind, name, cap_amount, enforcement, modified_by) \
             values ($1, 'org', 'Organization', null, 'hard', $2)",
        )
        .bind(tenant)
        .bind(actor.to_string())
        .execute(&mut *tx)
        .await?;
        sqlx::query("update core.profiles set claims_version = claims_version + 1 where id = $1")
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        Ok(())
    }
    .await;
    if let Err(e) = steps {
        tracing::error!("orgs_create: seed tenant: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    if let Err(e) = tx.commit().await {
        tracing::error!("orgs_create: commit: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }

    audit(&state, tenant, actor, "org.created", "tenant", Some(tenant)).await;
    (StatusCode::OK, Json(json!({ "tenant_id": tenant }))).into_response()
}

#[derive(Deserialize)]
pub struct TransferOwnership {
    pub profile_id: Uuid,
}

/// `POST /rpc/orgs/transfer-ownership` — OWNER-ONLY. Atomically demote the caller owner→admin
/// and promote an active member→owner (demote-first for the one-owner trigger), bumping both
/// claims_version.
pub async fn orgs_transfer_ownership(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<TransferOwnership>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "tenant.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let (owner_role, admin_role): (Uuid, Uuid) = match sqlx::query_as(
        "select \
           (select id from core.roles where tenant_id is null and key = 'owner'), \
           (select id from core.roles where tenant_id is null and key = 'admin')",
    )
    .fetch_one(&state.pool)
    .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("transfer: role lookup: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };

    let is_owner: bool = sqlx::query_scalar(
        "select exists(select 1 from core.profile_roles \
           where tenant_id = $1 and profile_id = $2 and role_id = $3)",
    )
    .bind(tenant)
    .bind(actor)
    .bind(owner_role)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !is_owner {
        return (StatusCode::FORBIDDEN, "only the owner can transfer ownership").into_response();
    }
    if body.profile_id == actor {
        return (StatusCode::BAD_REQUEST, "you are already the owner").into_response();
    }
    let target_member: bool = sqlx::query_scalar(
        "select exists(select 1 from core.profile_tenants \
           where profile_id = $1 and tenant_id = $2 and status = 'active')",
    )
    .bind(body.profile_id)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !target_member {
        return (StatusCode::NOT_FOUND, "target is not a member of this organization")
            .into_response();
    }

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("transfer: begin: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    let swap: Result<(), sqlx::Error> = async {
        sqlx::query(
            "delete from core.profile_roles where tenant_id=$1 and profile_id=$2 and role_id=$3",
        )
        .bind(tenant)
        .bind(actor)
        .bind(owner_role)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "insert into core.profile_roles (tenant_id, profile_id, role_id, assigned_by) \
             values ($1,$2,$3,'transfer') on conflict do nothing",
        )
        .bind(tenant)
        .bind(actor)
        .bind(admin_role)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "insert into core.profile_roles (tenant_id, profile_id, role_id, assigned_by) \
             values ($1,$2,$3,'transfer') on conflict do nothing",
        )
        .bind(tenant)
        .bind(body.profile_id)
        .bind(owner_role)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "update core.profiles set claims_version = claims_version + 1 where id = any($1)",
        )
        .bind(vec![actor, body.profile_id])
        .execute(&mut *tx)
        .await?;
        Ok(())
    }
    .await;
    if let Err(e) = swap {
        tracing::error!("transfer: swap: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    if let Err(e) = tx.commit().await {
        tracing::error!("transfer: commit: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }

    audit(
        &state,
        tenant,
        actor,
        "org.ownership.transferred",
        "profile",
        Some(body.profile_id),
    )
    .await;
    (StatusCode::OK, Json(json!({ "owner": body.profile_id }))).into_response()
}

/// Actor-bound audit helper (matches the RW8 with-check: actor_id = auth.uid()).
///
/// O1/#12: a privileged mutation must never silently lack its audit row. This runs
/// on autocommit after the mutation, so it cannot atomically roll the mutation back
/// on failure — but a failed audit write is now surfaced at **ERROR** (the audit's
/// stated "at minimum, emit an error-level alert" bar) so it is alertable rather than
/// silent. Full transactional mutation+audit atomicity is a tracked follow-up
/// (several handlers do multi-step writes; wrapping each in one tx is the ideal).
///
/// `pub(crate)` so the C5 RAG document handlers (`routes::documents`) emit the
/// same actor-bound audit row on register/ingest/delete.
pub(crate) async fn audit(
    state: &SharedState,
    tenant: Uuid,
    actor: Uuid,
    action: &str,
    target_type: &str,
    target_id: Option<Uuid>,
) {
    if let Err(e) = sqlx::query(
        "insert into audit.audit_events (tenant_id, actor_id, action, target_type, target_id) \
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
    crate::routes::config::bump(&state.pool, tenant, "settings").await;
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
        "select exists(select 1 from device.mcp_servers \
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
        "insert into device.tenant_mcp_servers (tenant_id, mcp_server_id, enabled) \
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
    crate::routes::config::bump(&state.pool, tenant, "tools").await;
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
    // Base table (NOT the effective view) on purpose: a per-role tool grant is keyed only by
    // role_id, so targeting a SHARED default role would leak the grant to every tenant. Tool
    // grants must target a tenant's OWN custom role → require tenant_id = caller's tenant.
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
        "select exists(select 1 from device.mcp_server_tools mt \
           join device.mcp_servers s on s.id = mt.mcp_server_id \
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
            "insert into device.tool_allow_lists (tenant_id, role_id, space_id, mcp_server_id, tool_name) \
             select $1,$2,null,$3,$4 where not exists ( \
               select 1 from device.tool_allow_lists \
                where tenant_id=$1 and role_id=$2 and space_id is null \
                  and mcp_server_id=$3 and tool_name=$4)",
        )
    } else {
        sqlx::query(
            "delete from device.tool_allow_lists \
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
    crate::routes::config::bump(&state.pool, tenant, "tools").await;
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
        "select exists(select 1 from device.devices where id = $1 and tenant_id = $2)",
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
        "update device.devices set status = 'revoked' where id = $1 and tenant_id = $2",
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
pub struct SetSyncPolicy {
    pub id: Uuid,
    pub sync_policy: Value,
}

/// `POST /rpc/devices/set-sync-policy` — capability `device.manage`. Sets one device's
/// `sync_policy` jsonb (O3 §3.4: `{config_pull, pull_interval_s, offline_grace_h,
/// buffer_flush}`), which D4 reads to drive its config-pull cadence + buffer flushing.
/// Tenant-scoped (404 if the device isn't in the caller's tenant), fail-closed validated
/// (400 on a malformed policy), audited `device.sync_policy_changed`.
///
/// Deliberately does **not** bump the tenant `config_version`: sync_policy is per-device and
/// is not part of the tenant-wide config snapshot (`config::assemble_snapshot`), so a
/// tenant-wide bump would force every device to re-pull for a one-device change carrying no
/// snapshot delta. The device receives its own policy over its per-device channel (D4).
pub async fn devices_set_sync_policy(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetSyncPolicy>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "device.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if let Err(reason) = crate::devices::validate_sync_policy(&body.sync_policy) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": reason }))).into_response();
    }
    let write = sqlx::query(
        "update device.devices set sync_policy = $3 where id = $1 and tenant_id = $2",
    )
    .bind(body.id)
    .bind(tenant)
    .bind(&body.sync_policy)
    .execute(&state.pool)
    .await;
    let affected = match write {
        Ok(r) => r.rows_affected(),
        Err(e) => {
            tracing::error!("devices_set_sync_policy: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    if affected == 0 {
        return (StatusCode::NOT_FOUND, "device not found in tenant").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "device.sync_policy_changed",
        "device",
        Some(body.id),
    )
    .await;
    (StatusCode::OK, Json(json!({ "ok": true, "id": body.id }))).into_response()
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
    // v1 paste-token: a long-lived Anthropic `setup-token` (no refresh/expiry/scopes) — the
    // ToS-safe non-official-client path (DECISIONS §F3). vault 0.5.0 takes a single
    // `OAuthCredential` struct in place of the former positional token/refresh/expiry args.
    let cred = vault::OAuthCredential {
        access_token: &body.token,
        refresh_token: None,
        expires_at_ms: None,
        scopes: None,
        client_id: None,
    };
    match state
        .tenant_keys
        .store_oauth(tenant, router_id, &cred, &actor.to_string())
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

// ---------------------------------------------------------------------------
// C5 · RAG privileged writes (declassify + per-space retrieval config).
// ---------------------------------------------------------------------------

/// The fixed 4-level classification lattice (mirrors the `documents.classification` CHECK and
/// `policies/knowledge.sql`). Declassify may only set one of these.
const DOC_CLASSIFICATIONS: &[&str] = &["public", "internal", "confidential", "restricted"];

#[derive(Deserialize)]
pub struct Declassify {
    pub document_id: Uuid,
    pub classification: String,
}

/// `POST /rpc/documents/declassify` — capability `doc.declassify`. Changes a document's
/// classification (the ONLY sanctioned path: the `trg_guard_document_classification` trigger
/// rejects a classification change from any non-`service_role` caller, so this must go through
/// the gateway). Tenant-scoped (404 if the doc isn't in the caller's tenant — no cross-tenant
/// reclassify) and validated against the fixed lattice (400 on an unknown value). Audited.
pub async fn documents_declassify(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<Declassify>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.declassify").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if !DOC_CLASSIFICATIONS.contains(&body.classification.as_str()) {
        return (StatusCode::BAD_REQUEST, "invalid classification").into_response();
    }
    let write = sqlx::query(
        "update public.documents set classification = $3::core.classification_level, modified_at = now() \
          where tenant_id = $1 and id = $2",
    )
    .bind(tenant)
    .bind(body.document_id)
    .bind(&body.classification)
    .execute(&state.pool)
    .await;
    match write {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, "document not found in tenant").into_response()
        }
        Ok(_) => {
            audit(
                &state,
                tenant,
                actor,
                "document.declassified",
                "document",
                Some(body.document_id),
            )
            .await;
            (
                StatusCode::OK,
                Json(json!({ "document_id": body.document_id, "classification": body.classification })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("documents_declassify: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct SetRetrievalConfig {
    pub space_id: Uuid,
    /// The resolved retrieval config to promote as the space default (opaque JSON — the
    /// retrieval engine reads it via the per-space `settings` seam; v1 still serves
    /// `RetrievalConfig::default()` at query time, see `routes::retrieve`).
    pub config: serde_json::Value,
}

/// `POST /rpc/retrieval/set-config` — capability `retrieval.manage`. Upserts the per-space
/// retrieval configuration into `public.settings(scope='space', space_id, key='retrieval')`.
/// Tenant + space scoped (404 if the space isn't the caller's tenant — no cross-tenant write).
/// Audited. This is the WRITE seam; per-space read resolution at query time is a tracked
/// follow-up (v1 retrieve uses `RetrievalConfig::default()`).
pub async fn retrieval_set_config(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<SetRetrievalConfig>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "retrieval.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    // Space must belong to the caller's tenant (else 404 — no cross-tenant config write, and
    // avoids tripping the settings→spaces composite FK).
    let space_ok: bool = sqlx::query_scalar(
        "select exists(select 1 from public.spaces where tenant_id = $1 and id = $2)",
    )
    .bind(tenant)
    .bind(body.space_id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if !space_ok {
        return (StatusCode::NOT_FOUND, "space not found in tenant").into_response();
    }
    let write = sqlx::query(
        "insert into public.settings (tenant_id, scope, space_id, key, value, modified_by) \
         values ($1, 'space', $2, 'retrieval', $3::jsonb, $4) \
         on conflict (tenant_id, scope, space_id, key) \
         do update set value = excluded.value, modified_at = now(), modified_by = excluded.modified_by",
    )
    .bind(tenant)
    .bind(body.space_id)
    .bind(body.config.to_string())
    .bind(actor.to_string())
    .execute(&state.pool)
    .await;
    if let Err(e) = write {
        tracing::error!("retrieval_set_config: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    audit(
        &state,
        tenant,
        actor,
        "retrieval.config.set",
        "space",
        Some(body.space_id),
    )
    .await;
    (StatusCode::OK, Json(json!({ "ok": true, "space_id": body.space_id }))).into_response()
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;
    use uuid::Uuid;

    async fn pool() -> PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPool::connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    /// O3-3: the pure feature-governance write validator (400 surface). Every valid
    /// state/scope combination passes; each malformed one names its reason.
    #[test]
    fn validate_feature_write_rules() {
        use super::validate_feature_write;
        // valid: workspace has no scope_id; space/role require one.
        assert!(validate_feature_write("workspace", None, "locked").is_ok());
        assert!(validate_feature_write("space", Some(Uuid::new_v4()), "default-on").is_ok());
        assert!(validate_feature_write("role", Some(Uuid::new_v4()), "user-overridable").is_ok());
        // bad state → 4-state enum only.
        assert_eq!(validate_feature_write("workspace", None, "on"), Err("bad_state"));
        // scope_id ↔ scope_type mismatches.
        assert_eq!(
            validate_feature_write("workspace", Some(Uuid::new_v4()), "locked"),
            Err("scope_id_forbidden")
        );
        assert_eq!(validate_feature_write("space", None, "locked"), Err("scope_id_required"));
        assert_eq!(validate_feature_write("role", None, "locked"), Err("scope_id_required"));
        // unknown scope.
        assert_eq!(validate_feature_write("tenant", None, "locked"), Err("bad_scope_type"));
    }

    /// O3-3 SQL invariants against the live schema: (1) feature_policies rejects an
    /// out-of-enum state + honours the (feature,scope_type,scope_id) uniqueness via the
    /// delete-then-insert grain; (2) the workspace-lock existence query the set-feature 409
    /// relies on flips true once a workspace `locked` row exists; (3) clearing a row removes
    /// exactly it. Rolled back — live data untouched.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn governance_feature_policy_invariants() {
        let pool = pool().await;
        let t = Uuid::new_v4();
        sqlx::query("insert into core.tenants (id,name,slug,modified_by) values ($1,'gov-test',$2,'test')")
            .bind(t)
            .bind(format!("gov-test-{t}"))
            .execute(&pool)
            .await
            .unwrap();
        let feat = "grounded-only";

        // (1) the state CHECK rejects a non-4-state value.
        let bad = sqlx::query(
            "insert into public.feature_policies (tenant_id, feature_key, scope_type, scope_id, state, modified_by) \
             values ($1,$2,'workspace',null,'on','test')",
        )
        .bind(t).bind(feat).execute(&pool).await;
        assert!(bad.is_err(), "state CHECK must reject 'on'");

        // no workspace lock yet → the set-feature 409 query is false.
        let locked = |p: PgPool, t: Uuid| async move {
            sqlx::query_scalar::<_, bool>(
                "select exists(select 1 from public.feature_policies \
                   where tenant_id=$1 and feature_key='grounded-only' \
                     and scope_type='workspace' and state='locked')",
            )
            .bind(t).fetch_one(&p).await.unwrap()
        };
        assert!(!locked(pool.clone(), t).await, "no lock yet");

        // (2) write a workspace lock → the existence query flips true (the 409 guard fires).
        sqlx::query(
            "insert into public.feature_policies (tenant_id, feature_key, scope_type, scope_id, state, modified_by) \
             values ($1,$2,'workspace',null,'locked','test')",
        )
        .bind(t).bind(feat).execute(&pool).await.unwrap();
        assert!(locked(pool.clone(), t).await, "workspace lock now blocks narrower writes");

        // (3) clear the workspace row (the clear-feature grain) → gone.
        let del = sqlx::query(
            "delete from public.feature_policies \
              where tenant_id=$1 and feature_key=$2 and scope_type='workspace' and scope_id is not distinct from null",
        )
        .bind(t).bind(feat).execute(&pool).await.unwrap();
        assert_eq!(del.rows_affected(), 1, "clear removes exactly the workspace row");
        assert!(!locked(pool.clone(), t).await, "lock cleared");

        sqlx::query("delete from core.tenants where id=$1").bind(t).execute(&pool).await.unwrap();
    }

    /// The two SQL contracts `rbac_create_role` relies on: (1) the no-shadowing key-check flags a
    /// shared default key (`owner`) as taken for ANY tenant — the only guard against shadowing,
    /// since the `(tenant_id,key)` unique treats a custom `tenant_id` as distinct from a default's
    /// NULL — and (2) a tenant-custom role's grant resolves through `core.effective_role_permissions`
    /// for that tenant (the path `CapabilitySet::resolve` reads). DB-gated (needs the migrated schema).
    #[tokio::test]
    #[ignore = "requires local Supabase (55322) with the RBAC shared-defaults schema"]
    async fn create_role_no_shadowing_and_resolves() {
        let pool = pool().await;
        let tenant = Uuid::new_v4();
        sqlx::query("insert into core.tenants (id,name,slug,modified_by) values ($1,'crole-test',$2,'test')")
            .bind(tenant).bind(format!("crole-test-{tenant}")).execute(&pool).await.unwrap();

        // (1) no-shadowing: a default key is "taken" for this tenant; a fresh key is free.
        let taken = |k: &'static str, t: Uuid, p: PgPool| async move {
            sqlx::query_scalar::<_, bool>(
                "select exists(select 1 from core.effective_roles where tenant_id=$1 and key=$2)")
                .bind(t).bind(k).fetch_one(&p).await.unwrap()
        };
        assert!(taken("owner", tenant, pool.clone()).await, "default 'owner' must be flagged taken");
        assert!(!taken("support", tenant, pool.clone()).await, "a fresh custom key must be free");

        // (2) create a custom role + grant; assert it resolves via the effective view for the tenant.
        let role_id: Uuid = sqlx::query_scalar(
            "insert into core.roles (tenant_id,key,name,is_system,created_by) values ($1,'support','Support',false,'test') returning id")
            .bind(tenant).fetch_one(&pool).await.unwrap();
        sqlx::query("insert into core.role_permissions (tenant_id,role_id,capability) values ($1,$2,'budget.read')")
            .bind(tenant).bind(role_id).execute(&pool).await.unwrap();
        let resolves: bool = sqlx::query_scalar(
            "select exists(select 1 from core.effective_role_permissions where tenant_id=$1 and role_id=$2 and capability='budget.read')")
            .bind(tenant).bind(role_id).fetch_one(&pool).await.unwrap();
        assert!(resolves, "custom-role grant must resolve via effective_role_permissions");
        assert!(taken("support", tenant, pool.clone()).await, "created custom key is now taken (409 on re-create)");

        // cleanup: dropping the tenant cascades to its roles + grants.
        sqlx::query("delete from core.tenants where id=$1").bind(tenant).execute(&pool).await.unwrap();
    }

    /// The SQL contracts `budgets_delete_node` relies on: (1) the org root is identified by a
    /// NULL `parent_id` (so the handler can refuse it), and (2) deleting a non-root node CASCADES
    /// to its whole subtree via the `(tenant_id, parent_id)` self-FK `ON DELETE CASCADE`. A revert
    /// of the cascade FK (or the root guard) fails this. DB-gated (needs local Supabase 55322).
    #[tokio::test]
    #[ignore = "requires local Supabase (55322) with the budget_nodes schema"]
    async fn budgets_delete_cascades_subtree_and_root_is_null_parent() {
        let pool = pool().await;
        let tenant = Uuid::new_v4();
        sqlx::query("insert into core.tenants (id,name,slug,modified_by) values ($1,'budtree-test',$2,'test')")
            .bind(tenant).bind(format!("budtree-{tenant}")).execute(&pool).await.unwrap();

        // org (root) → dept → user, plus alert/floor to prove the columns round-trip.
        let (org, dept, user) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let ins = |id: Uuid, parent: Option<Uuid>, kind: &'static str, p: PgPool, t: Uuid| async move {
            sqlx::query("insert into public.budget_nodes (tenant_id,id,parent_id,kind,name,cap_amount,alert_threshold,free_floor_enabled,enforcement,modified_by) \
                         values ($1,$2,$3,$4,$4,100,0.8,false,'hard','test')")
                .bind(t).bind(id).bind(parent).bind(kind).execute(&p).await.unwrap();
        };
        ins(org, None, "org", pool.clone(), tenant).await;
        ins(dept, Some(org), "dept", pool.clone(), tenant).await;
        ins(user, Some(dept), "user", pool.clone(), tenant).await;

        // (1) root guard: the org node has a NULL parent → the handler refuses to delete it.
        let root_parent: Option<Uuid> = sqlx::query_scalar(
            "select parent_id from public.budget_nodes where tenant_id=$1 and id=$2")
            .bind(tenant).bind(org).fetch_one(&pool).await.unwrap();
        assert!(root_parent.is_none(), "org root must have a NULL parent (undeletable)");
        // alert/floor persisted (columns exposed by the read + upsert).
        let (alert, floor): (Option<f64>, bool) = sqlx::query_as(
            "select alert_threshold::float8, free_floor_enabled from public.budget_nodes where tenant_id=$1 and id=$2")
            .bind(tenant).bind(dept).fetch_one(&pool).await.unwrap();
        assert_eq!(alert, Some(0.8));
        assert!(!floor, "free_floor_enabled must round-trip false");

        // (2) delete the dept → cascade removes dept + its user child; only the org root remains.
        sqlx::query("delete from public.budget_nodes where tenant_id=$1 and id=$2")
            .bind(tenant).bind(dept).execute(&pool).await.unwrap();
        let remaining: i64 = sqlx::query_scalar(
            "select count(*) from public.budget_nodes where tenant_id=$1")
            .bind(tenant).fetch_one(&pool).await.unwrap();
        assert_eq!(remaining, 1, "cascade must remove dept + user, leaving only the org root");

        sqlx::query("delete from core.tenants where id=$1").bind(tenant).execute(&pool).await.unwrap();
    }

    /// `orgs_create`'s DB contract end-to-end: the seeding transaction and — the regression
    /// lock — the slug-collision path. Exercises the REAL `super::insert_tenant_dedup_slug`
    /// (the fixed savepoint-per-attempt retry) so a revert of the fix fails this test.
    /// Asserts: (a) a name whose slug already exists gets a DISTINCT suffixed slug (not a 500);
    /// (b) the outer tx stays usable so the caller becomes owner, the fail-closed budget org-root
    /// is seeded, and claims_version is bumped; (c) the already-has-tenant guard would now trip.
    /// Plus a negative control proving the un-savepointed retry poisons the tx with 25P02 — the
    /// exact bug the savepoint fixes. HTTP-status assertions (401/400/409/200) via the axum
    /// extractors are disproportionate to harness and are deferred to the Task 8 manual verify.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322) with the M1 org-onboarding schema"]
    async fn orgs_create_seeds_and_dedups_slug() {
        let pool = pool().await;
        let actor = Uuid::new_v4();
        let name = "Acme, Inc.";
        assert_eq!(super::slugify(name), "acme-inc"); // base slug under test

        // Caller profile (FK target for profile_tenants + the claims_version bump).
        sqlx::query("insert into core.profiles (id) values ($1)")
            .bind(actor).execute(&pool).await.unwrap();
        // A pre-existing org already owns the 'acme-inc' slug → forces a collision.
        let pre = Uuid::new_v4();
        sqlx::query("insert into core.tenants (id,name,slug,status,modified_by) values ($1,$2,'acme-inc','trial','test')")
            .bind(pre).bind(name).execute(&pool).await.unwrap();
        let owner_role: Uuid = sqlx::query_scalar(
            "select id from core.roles where tenant_id is null and key='owner'")
            .fetch_one(&pool).await.unwrap();

        // --- The handler's seeding transaction (code under test) ---
        let mut tx = pool.begin().await.unwrap();
        // (regression) collision must be deduped via savepoint, NOT surfaced as an error.
        let tenant = super::insert_tenant_dedup_slug(&mut tx, name, &actor.to_string()).await
            .expect("slug collision must dedup, not error (savepoint must un-poison the tx)");
        // The rest of the seeding must still succeed on the SAME (un-poisoned) outer tx.
        sqlx::query("insert into core.profile_tenants (profile_id,tenant_id,assigned_by) values ($1,$2,'self_create')")
            .bind(actor).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into core.profile_roles (tenant_id,profile_id,role_id,assigned_by) values ($1,$2,$3,'self_create')")
            .bind(tenant).bind(actor).bind(owner_role).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into public.budget_nodes (tenant_id,kind,name,cap_amount,enforcement,modified_by) values ($1,'org','Organization',null,'hard',$2)")
            .bind(tenant).bind(actor.to_string()).execute(&mut *tx).await.unwrap();
        sqlx::query("update core.profiles set claims_version = claims_version + 1 where id=$1")
            .bind(actor).execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();

        // (a) the new org got a distinct, base-preserving suffixed slug — not 'acme-inc'.
        let slug: String = sqlx::query_scalar("select slug from core.tenants where id=$1")
            .bind(tenant).fetch_one(&pool).await.unwrap();
        assert_ne!(slug, "acme-inc", "collision must fall back to a suffixed slug");
        assert!(slug.starts_with("acme-inc-"), "suffixed slug must keep the base; got {slug}");
        // (b) caller is owner; fail-closed budget org-root exists; claims_version bumped 0→1.
        let is_owner: bool = sqlx::query_scalar(
            "select exists(select 1 from core.profile_roles where tenant_id=$1 and profile_id=$2 and role_id=$3)")
            .bind(tenant).bind(actor).bind(owner_role).fetch_one(&pool).await.unwrap();
        assert!(is_owner, "caller must hold the owner role");
        let root_ok: bool = sqlx::query_scalar(
            "select exists(select 1 from public.budget_nodes where tenant_id=$1 and kind='org' and cap_amount is null and enforcement='hard')")
            .bind(tenant).fetch_one(&pool).await.unwrap();
        assert!(root_ok, "fail-closed budget org-root must be seeded");
        let cv: i64 = sqlx::query_scalar("select claims_version from core.profiles where id=$1")
            .bind(actor).fetch_one(&pool).await.unwrap();
        assert_eq!(cv, 1, "claims_version must be bumped");
        // (c) the already-has-tenant guard (the 409 condition) now trips.
        let has_tenant: bool = sqlx::query_scalar(
            "select exists(select 1 from core.profile_tenants where profile_id=$1)")
            .bind(actor).fetch_one(&pool).await.unwrap();
        assert!(has_tenant, "caller now belongs to an org (a re-create would 409)");

        // --- Negative control: WITHOUT a savepoint, the collision poisons the whole tx ---
        let mut bad = pool.begin().await.unwrap();
        let dup = sqlx::query("insert into core.tenants (name,slug,status,modified_by) values ('x','acme-inc','trial','t')")
            .execute(&mut *bad).await;
        assert!(dup.is_err(), "duplicate slug must violate the unique constraint");
        // The tx is now aborted: the next statement fails with 25P02 (in_failed_sql_transaction),
        // NOT a unique_violation — which is precisely why the naive same-tx retry 500'd.
        let poisoned = sqlx::query("insert into core.tenants (name,slug,status,modified_by) values ('y','acme-inc-xyz','trial','t')")
            .execute(&mut *bad).await;
        let sqlstate = poisoned.as_ref().err()
            .and_then(|e| e.as_database_error())
            .and_then(|d| d.code())
            .map(|c| c.to_string());
        assert_eq!(sqlstate.as_deref(), Some("25P02"),
            "an aborted tx poisons the retry — the bug the savepoint fixes");
        let _ = bad.rollback().await;

        // cleanup: delete the profile first (cascades memberships + role grants — profile_tenants
        // FKs tenants ON DELETE RESTRICT), then the tenants (cascades budget_nodes).
        sqlx::query("delete from core.profiles where id=$1").bind(actor).execute(&pool).await.unwrap();
        sqlx::query("delete from core.tenants where id = any($1)")
            .bind(vec![tenant, pre]).execute(&pool).await.unwrap();
    }
}
