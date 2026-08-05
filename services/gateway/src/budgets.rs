//! C3 budget hot-path (P5, DECISIONS §2 W2): resolve the caller's budget node and
//! run a concurrency-safe hard **reserve → commit** around the inference call.
//!
//! Budgets bind to the identity/node, never to a key. At execution C1 resolves the
//! authenticated caller → their personal unit's node (via `core.unit_members`, §D Phase 5),
//! reserves a worst-case estimate (PR-4), runs inference, then commits the actual spend
//! (releasing the surplus). Enforcement is server-side + serialized in the DB
//! (`budget_reserve` locks the ancestor path FOR UPDATE) — a `hard` cap cannot be
//! exceeded even under concurrency. **Fail-closed**: no resolvable node ⇒ deny.

use sqlx::PgPool;
use uuid::Uuid;

/// Conservative worst-case USD per output token for the pre-call reserve. Set above
/// the priciest routed model so a `hard` cap can never be exceeded by
/// under-estimation; the surplus hold is released at commit (PR-4). Operator-tunable
/// later — a fallback constant, not a baked provider price.
const WORST_CASE_USD_PER_TOKEN: f64 = 0.00006;

#[derive(Debug)]
pub enum BudgetError {
    /// The caller resolves to no budget node — deny (fail-closed).
    NoNode,
    /// A `hard` cap in the node's ancestor path has no headroom for the reserve.
    Exceeded,
    Db(sqlx::Error),
}

impl From<sqlx::Error> for BudgetError {
    fn from(e: sqlx::Error) -> Self {
        BudgetError::Db(e)
    }
}

/// Worst-case reserve amount (PR-4). A true upper bound on the call's cost: charges
/// BOTH the estimated INPUT tokens and the requested `max_output` tokens at the
/// worst-case rate. Billing input at the same conservative output rate over-reserves
/// (safe for a `hard` cap — a tiny `max_output` with a huge prompt can no longer slip
/// past the headroom check); the surplus is released at commit.
pub fn estimate(input_est: u32, max_output: u32) -> f64 {
    ((input_est as u64 + max_output as u64) as f64) * WORST_CASE_USD_PER_TOKEN
}

/// Resolve the caller's budget node id (§D Phase 5: over the split org tree). Their PERSONAL unit's
/// node (`core.unit_members` → `core.org_units.is_personal` → `governance.nodes`) first, else the
/// tenant's org-root node (`core.org_units.parent_id is null`). The returned id is a
/// `governance.nodes.id` which == its `org_unit_id` (DC-1), so `budget_reserve` walks the org tree from
/// it. Fail-closed (`NoNode`) when neither exists — every ancestor unit with a hard cap is enforced.
pub async fn resolve_node(pool: &PgPool, tenant: Uuid, subject: Uuid) -> Result<Uuid, BudgetError> {
    let leaf: Option<Uuid> = sqlx::query_scalar(
        "select n.id from governance.nodes n \
           join core.org_units ou on ou.tenant_id = n.tenant_id and ou.id = n.org_unit_id \
           join core.unit_members um on um.tenant_id = ou.tenant_id and um.unit_id = ou.id \
          where n.tenant_id = $1 and um.profile_id = $2 \
          order by ou.is_personal desc limit 1",
    )
    .bind(tenant)
    .bind(subject)
    .fetch_optional(pool)
    .await?;
    if let Some(id) = leaf {
        return Ok(id);
    }

    let root: Option<Uuid> = sqlx::query_scalar(
        "select n.id from governance.nodes n \
           join core.org_units ou on ou.tenant_id = n.tenant_id and ou.id = n.org_unit_id \
          where n.tenant_id = $1 and ou.parent_id is null \
          order by ou.level asc limit 1",
    )
    .bind(tenant)
    .fetch_optional(pool)
    .await?;
    root.ok_or(BudgetError::NoNode)
}

/// Hard reserve `amount` against `node`'s ancestor path. Maps the DB
/// `check_violation` (over a hard cap) → [`BudgetError::Exceeded`].
pub async fn reserve(
    pool: &PgPool,
    tenant: Uuid,
    node: Uuid,
    amount: f64,
    idem: Option<&str>,
) -> Result<Uuid, BudgetError> {
    let res =
        sqlx::query_scalar::<_, Uuid>("select public.budget_reserve($1, $2, $3::numeric, $4)")
            .bind(tenant)
            .bind(node)
            .bind(amount)
            .bind(idem)
            .fetch_one(pool)
            .await;
    match res {
        Ok(hold) => Ok(hold),
        Err(e) => {
            // 23514 = check_violation — raised by budget_reserve over a hard cap.
            if e.as_database_error().and_then(|d| d.code()).as_deref() == Some("23514") {
                Err(BudgetError::Exceeded)
            } else {
                Err(BudgetError::Db(e))
            }
        }
    }
}

/// Commit a hold and record the actual spend on the node path (releases the surplus).
pub async fn commit(
    pool: &PgPool,
    tenant: Uuid,
    hold: Uuid,
    actual: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query("select public.budget_commit($1, $2, $3::numeric)")
        .bind(tenant)
        .bind(hold)
        .bind(actual)
        .execute(pool)
        .await?;
    Ok(())
}

/// Release a hold without spending (the inference failed) — frees the reserved headroom.
pub async fn release(pool: &PgPool, tenant: Uuid, hold: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("select public.budget_release($1, $2)")
        .bind(tenant)
        .bind(hold)
        .execute(pool)
        .await?;
    Ok(())
}
