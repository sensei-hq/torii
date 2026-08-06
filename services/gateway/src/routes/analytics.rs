//! O2 (P12) · analytics read model — tenant-scoped, read-only dashboards over the one
//! `inference_calls` ledger (+ `quality_signals`, catalog, budget tree).
//!
//! `GET /v1/analytics/overview`     — W1 stat row (spend/calls/fallbacks/latency/blended/savings)
//! `GET /v1/analytics/cost-trend`   — blended cost/call series + delta
//! `GET /v1/analytics/model-mix`    — per-model calls/share/cost/savings
//! `GET /v1/analytics/plane-split`  — local-vs-cloud savings (the headline claim) ◀ gate
//! `GET /v1/analytics/spend`        — per-scope spend, grouped WITHOUT recursion (GH-5) ◀ gate
//! `GET /v1/analytics/quality`      — grounding/judge/guardrail/redaction/rating aggregates
//! `GET /v1/analytics/export`       — AGGREGATED CSV/JSON (raw-row export is O1's surface)
//!
//! Tenant is taken from the verified credential (never the body); the gateway runs as the
//! superuser role, so every query filters by `tenant_id` explicitly. Spend + plane-split
//! read the ledger on the fly (they need the GH-5 denormalized attribution columns and the
//! per-call cloud-equivalent baseline); the rollup-backed panels read the live
//! `analytics_*` tables (kept current by the A2 triggers). A7 scope authz: own-subtree
//! reads need no capability; tenant-wide / cross-subtree (or a `scope_node_id` outside the
//! caller's subtree) requires `audit.read` (analytics observability shares O1's audit gate)
//! → else `403 capability_required`.

use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    analytics::{scope_decision, Bucket, ExportReport, ScopeDecision, ScopeFilter, SpendGroup, Window},
    auth::Claims,
    capabilities::{check_claims_version, CapabilitySet},
    state::SharedState,
};

fn capability_required(cap: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "capability_required", "capability": cap })),
    )
        .into_response()
}

#[derive(Debug)]
enum ScopeErr {
    Denied,
    Db(sqlx::Error),
}

/// All node ids in the subtree rooted at `root` (root + descendants) — a bounded
/// budget-tree walk used only for authz scoping, NOT on the spend aggregation path (the
/// P12 no-recursive-CTE gate is about the spend GROUP BY, which stays recursion-free).
async fn subtree_ids(pool: &sqlx::PgPool, tenant: Uuid, root: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    // §D Phase 5: the subtree is over the org tree (core.org_units.parent_id). The ids are org_unit
    // ids == the ledger's org_unit_id values (DC-1), so the `org_unit_id = any(subtree)` filter
    // on analytics rows still matches.
    sqlx::query_scalar(
        "with recursive sub as ( \
           select id from core.org_units where tenant_id = $1 and id = $2 \
           union all \
           select b.id from core.org_units b \
             join sub on b.parent_id = sub.id where b.tenant_id = $1) \
         select id from sub",
    )
    .bind(tenant)
    .bind(root)
    .fetch_all(pool)
    .await
}

/// The scope-filter resolution (testable without the auth stack): resolve the caller's
/// PERSONAL unit (`core.unit_members` → `core.org_units.is_personal`, no org-root fallback — that
/// would leak tenant-wide), then apply [`scope_decision`]. `has_wide` = holds `audit.read`. §D Phase 5.
async fn scope_filter_for(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    subject: Uuid,
    has_wide: bool,
    requested: Option<Uuid>,
) -> Result<ScopeFilter, ScopeErr> {
    let own_leaf: Option<Uuid> = sqlx::query_scalar(
        "select ou.id from core.org_units ou \
           join core.unit_members um on um.tenant_id = ou.tenant_id and um.unit_id = ou.id \
          where ou.tenant_id = $1 and um.profile_id = $2 and ou.is_personal limit 1",
    )
    .bind(tenant)
    .bind(subject)
    .fetch_optional(pool)
    .await
    .map_err(ScopeErr::Db)?;

    let own_subtree = match own_leaf {
        Some(o) => subtree_ids(pool, tenant, o).await.map_err(ScopeErr::Db)?,
        None => Vec::new(),
    };
    let in_own = requested.map(|s| own_subtree.contains(&s)).unwrap_or(false);

    match scope_decision(has_wide, requested, own_leaf, in_own) {
        ScopeDecision::Unrestricted => Ok(ScopeFilter::All),
        ScopeDecision::Scope(root) => {
            Ok(ScopeFilter::Nodes(subtree_ids(pool, tenant, root).await.map_err(ScopeErr::Db)?))
        }
        ScopeDecision::Denied => Err(ScopeErr::Denied),
    }
}

/// A7 scope authz for an analytics read: freshness gate → capability resolution → scope.
/// Own-subtree reads need no capability; tenant-wide / cross-subtree needs `audit.read`
/// (analytics observability shares O1's audit gate). Returns `(tenant, ScopeFilter)` or a
/// mapped `401`/`403` response. The returned filter is bound to every query as the
/// `org_unit_id = any($n)` predicate.
async fn resolve_scope(
    state: &SharedState,
    claims: &Claims,
    requested: Option<Uuid>,
) -> Result<(Uuid, ScopeFilter), Response> {
    let tenant = claims
        .tenant_id
        .ok_or_else(|| (StatusCode::FORBIDDEN, "no active tenant").into_response())?;
    check_claims_version(&state.pool, claims)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, "stale token — re-authenticate").into_response())?;
    let caps = CapabilitySet::resolve(&state.pool, claims).await.map_err(|e| {
        tracing::error!("analytics caps: {e}");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    })?;
    let subject = Uuid::parse_str(&claims.sub)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "bad subject").into_response())?;
    match scope_filter_for(&state.pool, tenant, subject, caps.has("audit.read"), requested).await {
        Ok(filter) => Ok((tenant, filter)),
        Err(ScopeErr::Denied) => Err(capability_required("audit.read")),
        Err(ScopeErr::Db(e)) => Err(read_err("scope", e)),
    }
}

fn read_err(what: &str, e: sqlx::Error) -> Response {
    tracing::error!("analytics {what}: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
}

// Per-call cloud-equivalent savings, computed on the ledger via the shared baseline helper.
// Cloud calls have no savings; local calls get greatest(cloud_equiv − cost, 0) unless the
// chain is local-only / unpriced. Mirrors analytics_rollup_apply so on-the-fly reads agree
// with the rollups. `ce` is the LEFT JOIN LATERAL alias bound only for local rows.
const SAVINGS_EXPR: &str = "case \
     when coalesce(ic.execution_location,'cloud') = 'cloud' then 0 \
     when ce.is_local_only or ce.is_unpriced then 0 \
     else greatest(coalesce(ce.cloud_equiv_usd,0) - coalesce(ic.cost_usd,0), 0) end";

const CLOUD_EQUIV_EXPR: &str = "case \
     when coalesce(ic.execution_location,'cloud') = 'cloud' then coalesce(ic.cost_usd,0) \
     when ce.is_local_only or ce.is_unpriced then 0 \
     else coalesce(ce.cloud_equiv_usd,0) end";

// LEFT JOIN LATERAL onto the baseline helper for local rows only (cloud rows → ce = NULL).
const CE_LATERAL: &str = "left join lateral metering.cloud_equiv( \
       ic.tenant_id, ic.chain_id, coalesce(ic.input_tokens,0), coalesce(ic.output_tokens,0)) ce \
     on coalesce(ic.execution_location,'cloud') = 'local'";

// ── overview ───────────────────────────────────────────────────────────────
pub async fn get_overview(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let (tenant, scope) = match resolve_scope(&state, &claims, None).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    // Served from the live usage rollup (fresh via the A2 triggers): today's stat row,
    // trailing-14d blended cost/call + prior-14d delta, and 14d savings.
    let q = "select json_build_object( \
        'spend_today', json_build_object('value', s.spend_today, 'cap', s.cap, 'unit', 'usd', \
           'pct_of_cap', case when s.cap > 0 then round((100*s.spend_today/s.cap)::numeric,1) else null end), \
        'calls_today', json_build_object('value', s.calls_today, 'delta_pct_vs_prev', s.calls_delta), \
        'fallbacks_today', json_build_object('value', s.fallbacks_today), \
        'latency', json_build_object('avg_ms', s.lat_avg, 'p95_ms', s.lat_p95), \
        'blended_cost_per_call', json_build_object('value', s.blended14, 'unit', 'usd', \
           'window_days', 14, 'delta_pct', s.blended_delta), \
        'savings_14d', json_build_object('value', s.savings14, 'unit', 'usd', \
           'vs_baseline', 'cheapest_cloud_in_chain')) \
      from ( \
        select \
          coalesce(sum(cost_usd) filter (where day = current_date),0)::float8 as spend_today, \
          (select n.cap_amount::float8 from governance.nodes n \
             join core.org_units ou on ou.tenant_id = n.tenant_id and ou.id = n.org_unit_id \
             where n.tenant_id = $1 and ou.parent_id is null order by n.cap_amount desc nulls last limit 1) as cap, \
          coalesce(sum(calls) filter (where day = current_date),0) as calls_today, \
          case when coalesce(sum(calls) filter (where day = current_date - 1),0) > 0 \
               then round((100.0*(sum(calls) filter (where day = current_date) \
                    - sum(calls) filter (where day = current_date - 1)) \
                    / nullif(sum(calls) filter (where day = current_date - 1),0))::numeric,1) else null end as calls_delta, \
          coalesce(sum(fallback_calls) filter (where day = current_date),0) as fallbacks_today, \
          case when coalesce(sum(latency_ms_count) filter (where day = current_date),0) > 0 \
               then round((sum(latency_ms_sum) filter (where day = current_date)::numeric \
                    / sum(latency_ms_count) filter (where day = current_date)),0)::int else null end as lat_avg, \
          max(latency_ms_p95) filter (where day = current_date) as lat_p95, \
          case when coalesce(sum(calls) filter (where day > current_date - 14),0) > 0 \
               then round((sum(cost_usd) filter (where day > current_date - 14) \
                    / nullif(sum(calls) filter (where day > current_date - 14),0))::numeric,6)::float8 else 0 end as blended14, \
          case when coalesce(sum(calls) filter (where day between current_date - 28 and current_date - 15),0) > 0 \
                and coalesce(sum(calls) filter (where day > current_date - 14),0) > 0 \
               then round((100.0*((sum(cost_usd) filter (where day > current_date - 14)/nullif(sum(calls) filter (where day > current_date - 14),0)) \
                    - (sum(cost_usd) filter (where day between current_date - 28 and current_date - 15)/nullif(sum(calls) filter (where day between current_date - 28 and current_date - 15),0))) \
                    / nullif((sum(cost_usd) filter (where day between current_date - 28 and current_date - 15)/nullif(sum(calls) filter (where day between current_date - 28 and current_date - 15),0)),0))::numeric,1) else null end as blended_delta, \
          coalesce(sum(savings_usd) filter (where day > current_date - 14),0)::float8 as savings14 \
        from metering.usage_daily \
        where tenant_id = $1 and ($2::uuid[] is null or org_unit_id = any($2))) s";
    match sqlx::query_scalar::<_, Value>(q)
        .bind(tenant)
        .bind(scope.bind())
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => read_err("overview", e),
    }
}

// ── cost-trend ─────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct TrendQ {
    pub window: Option<String>,
    pub bucket: Option<String>,
    pub scope_node_id: Option<Uuid>,
}

pub async fn get_cost_trend(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<TrendQ>,
) -> Response {
    let (tenant, scope) = match resolve_scope(&state, &claims, q.scope_node_id).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    let win = match Window::parse(q.window.as_deref()) {
        Ok(w) => w,
        Err(e) => return e.into_response(),
    };
    if let Err(e) = Bucket::parse(q.bucket.as_deref()) {
        return e.into_response();
    }
    let sql = "select json_build_object('series', coalesce(series,'[]'::json), 'delta_pct', delta) from ( \
        select \
          (select json_agg(x order by x.day) from ( \
             select day, \
                    round((cost_usd/nullif(calls,0))::numeric,6)::float8 as blended_cost_per_call, \
                    cost_usd::float8 as cost_usd, calls, savings_usd::float8 as savings_usd \
               from ( select day, sum(cost_usd) cost_usd, sum(calls) calls, sum(savings_usd) savings_usd \
                        from metering.usage_daily \
                       where tenant_id = $1 and day > current_date - $2 \
                         and ($3::uuid[] is null or org_unit_id = any($3)) \
                       group by day) d) x) as series, \
          ( select round((100.0*((sum(cost_usd) filter (where day > current_date - ($2/2)) / nullif(sum(calls) filter (where day > current_date - ($2/2)),0)) \
                   - (sum(cost_usd) filter (where day <= current_date - ($2/2)) / nullif(sum(calls) filter (where day <= current_date - ($2/2)),0))) \
                   / nullif((sum(cost_usd) filter (where day <= current_date - ($2/2)) / nullif(sum(calls) filter (where day <= current_date - ($2/2)),0)),0))::numeric,1) \
              from metering.usage_daily where tenant_id = $1 and day > current_date - $2 \
                and ($3::uuid[] is null or org_unit_id = any($3))) as delta \
        ) t";
    match sqlx::query_scalar::<_, Value>(sql)
        .bind(tenant)
        .bind(win.days)
        .bind(scope.bind())
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => read_err("cost-trend", e),
    }
}

// ── model-mix ──────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct WindowQ {
    pub window: Option<String>,
    pub scope_node_id: Option<Uuid>,
}

pub async fn get_model_mix(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<WindowQ>,
) -> Response {
    let (tenant, scope) = match resolve_scope(&state, &claims, q.scope_node_id).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    let win = match Window::parse(q.window.as_deref()) {
        Ok(w) => w,
        Err(e) => return e.into_response(),
    };
    let sql = "select json_build_object('models', coalesce(json_agg(t order by t.calls desc), '[]'::json)) from ( \
        select served_model as model, provider, execution_location, \
               sum(calls) as calls, \
               round((100.0*sum(calls)/nullif(sum(sum(calls)) over (),0))::numeric,1)::float8 as share_pct, \
               sum(cost_usd)::float8 as cost_usd, sum(savings_usd)::float8 as savings_usd \
          from metering.usage_daily \
         where tenant_id = $1 and day > current_date - $2 \
           and ($3::uuid[] is null or org_unit_id = any($3)) \
         group by served_model, provider, execution_location) t";
    match sqlx::query_scalar::<_, Value>(sql)
        .bind(tenant)
        .bind(win.days)
        .bind(scope.bind())
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => read_err("model-mix", e),
    }
}

// ── plane-split (headline gate half 2) ───────────────────────────────────────
#[derive(Deserialize)]
pub struct ScopedWindowQ {
    pub window: Option<String>,
    pub scope_node_id: Option<Uuid>,
}

/// Plane-split query ($1 tenant, $2 days, $3 optional scope node). Off the ledger so savings
/// come from the per-call cloud-equivalent baseline and the scope filter can use the
/// denormalized attribution path (subtree, no recursion).
fn plane_split_sql() -> String {
    format!(
        "with pc as ( \
           select coalesce(ic.execution_location,'cloud') as plane, ic.recorded_at::date as day, \
                  coalesce(ic.cost_usd,0) as cost_usd, {ce} as cloud_equiv, {sav} as savings \
             from metering.inference_calls ic {lat} \
            where ic.tenant_id = $1 \
              and ic.recorded_at >= now() - make_interval(days => $2) \
              and ($3::uuid[] is null or ic.org_unit_id = any($3)) \
              and ic.org_unit_id is not null) \
         select json_build_object( \
           'local', json_build_object('calls', l.calls, 'cost_usd', l.cost, 'cloud_equiv_usd', l.ce), \
           'cloud', json_build_object('calls', c.calls, 'cost_usd', c.cost, 'cloud_equiv_usd', c.ce), \
           'savings_usd', l.savings, \
           'savings_pct', case when (c.cost + l.savings) > 0 then round((100.0*l.savings/(c.cost + l.savings))::numeric,1) else 0 end, \
           'baseline', 'cheapest_cloud_in_chain', \
           'series', coalesce(( select json_agg(s order by s.day) from ( \
              select day, count(*) filter (where plane='local') as local_calls, \
                     count(*) filter (where plane='cloud') as cloud_calls, \
                     sum(savings)::float8 as savings_usd \
                from pc group by day) s), '[]'::json)) \
         from (select count(*) calls, coalesce(sum(cost_usd),0)::float8 cost, coalesce(sum(cloud_equiv),0)::float8 ce, coalesce(sum(savings),0)::float8 savings from pc where plane='local') l, \
              (select count(*) calls, coalesce(sum(cost_usd),0)::float8 cost, coalesce(sum(cloud_equiv),0)::float8 ce from pc where plane='cloud') c",
        ce = CLOUD_EQUIV_EXPR, sav = SAVINGS_EXPR, lat = CE_LATERAL
    )
}

pub async fn get_plane_split(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<ScopedWindowQ>,
) -> Response {
    let (tenant, scope) = match resolve_scope(&state, &claims, q.scope_node_id).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    let win = match Window::parse(q.window.as_deref()) {
        Ok(w) => w,
        Err(e) => return e.into_response(),
    };
    let sql = plane_split_sql();
    match sqlx::query_scalar::<_, Value>(&sql)
        .bind(tenant)
        .bind(win.days)
        .bind(scope.bind())
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => read_err("plane-split", e),
    }
}

// ── spend (gate half 1: per-scope, NO recursive CTE) ─────────────────────────
#[derive(Deserialize)]
pub struct SpendQ {
    pub window: Option<String>,
    pub group_by: Option<String>,
    pub scope_node_id: Option<Uuid>,
}

/// Assemble the spend query for a validated group dimension. The group column comes from
/// the closed `SpendGroup` enum (never raw input) → injection-safe; for tree dims it is a
/// **denormalized `*_node_id`** path column, so the GROUP BY needs no recursive tree walk.
fn spend_sql(group: SpendGroup) -> String {
    // §D LN-3c-2b (P12 reversal): node dims resolve each call's leaf org_unit to its ancestor at the
    // tier level via core.org_unit_ancestor_at_level (a per-call tree walk); attribute dims group by a
    // scalar ledger column. `grp` is a uuid (node) or text (attribute) — one shape per generated query.
    let grp = match group.level() {
        Some(lvl) => format!("core.org_unit_ancestor_at_level(ic.tenant_id, ic.org_unit_id, {lvl})"),
        None => format!("ic.{}", group.attr_column()),
    };
    let per_call = format!(
        "with pc as ( \
           select {grp} as grp, coalesce(ic.cost_usd,0) as cost_usd, {sav} as savings \
             from metering.inference_calls ic {lat} \
            where ic.tenant_id = $1 \
              and ic.recorded_at >= now() - make_interval(days => $2) \
              and ($3::uuid[] is null or ic.org_unit_id = any($3)))",
        grp = grp, sav = SAVINGS_EXPR, lat = CE_LATERAL
    );
    if group.is_node() {
        format!(
            "{per_call} \
             select json_build_object('rows', coalesce(json_agg(t order by t.cost_usd desc), '[]'::json)) from ( \
               select (pc.grp)::text as node_id, ou.name as node_name, core.unit_kind(ou.level) as kind, \
                      sum(pc.cost_usd)::float8 as cost_usd, count(*) as calls, sum(pc.savings)::float8 as savings_usd, \
                      n.cap_amount::float8 as cap_usd, \
                      case when n.cap_amount > 0 then round((100.0*sum(pc.cost_usd)/n.cap_amount)::numeric,1)::float8 else null end as pct_of_cap \
                 from pc \
                 join core.org_units ou on ou.tenant_id = $1 and ou.id = pc.grp \
                 left join governance.nodes n on n.tenant_id = $1 and n.org_unit_id = ou.id \
                where pc.grp is not null \
                group by pc.grp, ou.name, ou.level, n.cap_amount) t"
        )
    } else {
        format!(
            "{per_call} \
             select json_build_object('rows', coalesce(json_agg(t order by t.cost_usd desc), '[]'::json)) from ( \
               select (pc.grp)::text as node_id, (pc.grp)::text as node_name, null::text as kind, \
                      sum(pc.cost_usd)::float8 as cost_usd, count(*) as calls, sum(pc.savings)::float8 as savings_usd, \
                      null::float8 as cap_usd, null::float8 as pct_of_cap \
                 from pc where pc.grp is not null group by pc.grp) t"
        )
    }
}

pub async fn get_spend(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<SpendQ>,
) -> Response {
    let (tenant, scope) = match resolve_scope(&state, &claims, q.scope_node_id).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    let win = match Window::parse(q.window.as_deref()) {
        Ok(w) => w,
        Err(e) => return e.into_response(),
    };
    let group = match SpendGroup::parse(q.group_by.as_deref().unwrap_or("team")) {
        Ok(g) => g,
        Err(e) => return e.into_response(),
    };
    let sql = spend_sql(group);
    match sqlx::query_scalar::<_, Value>(&sql)
        .bind(tenant)
        .bind(win.days)
        .bind(scope.bind())
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => read_err("spend", e),
    }
}

// ── quality ──────────────────────────────────────────────────────────────────
pub async fn get_quality(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<WindowQ>,
) -> Response {
    let (tenant, scope) = match resolve_scope(&state, &claims, q.scope_node_id).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    let win = match Window::parse(q.window.as_deref()) {
        Ok(w) => w,
        Err(e) => return e.into_response(),
    };
    // Call-weighted aggregates over the quality rollup, per served model.
    let sql = "select json_build_object('rows', coalesce(json_agg(t order by t.calls desc), '[]'::json)) from ( \
        select served_model as model, \
               round(avg(grounding_avg)::numeric,1)::float8 as grounding_avg, \
               round(avg(judge_score_avg)::numeric,1)::float8 as judge_score_avg, \
               sum(guardrail_hit_calls) as guardrail_hit_calls, \
               sum(redaction_hit_calls) as redaction_hit_calls, \
               round(avg(rating_avg)::numeric,2)::float8 as rating_avg, \
               sum(rated_calls) as rated_calls, \
               (sum(thumb_up) + sum(thumb_down) + sum(accept_calls) + sum(edit_calls) + sum(retry_calls)) as interactions \
          from metering.quality_daily \
         where tenant_id = $1 and day > current_date - $2 \
           and ($3::uuid[] is null or org_unit_id = any($3)) \
         group by served_model) t";
    match sqlx::query_scalar::<_, Value>(sql)
        .bind(tenant)
        .bind(win.days)
        .bind(scope.bind())
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => read_err("quality", e),
    }
}

// ── export (aggregates only) ──────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct ExportQ {
    pub report: Option<String>,
    pub window: Option<String>,
    pub format: Option<String>,
}

pub async fn get_export(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<ExportQ>,
) -> Response {
    let (tenant, scope) = match resolve_scope(&state, &claims, None).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    let win = match Window::parse(q.window.as_deref()) {
        Ok(w) => w,
        Err(e) => return e.into_response(),
    };
    // `raw-calls` (etc.) is rejected by the enum → aggregates only; O1 owns raw/SIEM export.
    let report = match ExportReport::parse(q.report.as_deref().unwrap_or("")) {
        Ok(r) => r,
        Err(e) => return e.into_response(),
    };
    // One flat aggregate view per report, streamed as rows.
    let rows_sql = match report {
        ExportReport::PlaneSplit | ExportReport::Spend => {
            // spend-by-node + plane both come off the ledger (denormalized cols, no recursion).
            "select json_build_object('rows', coalesce(json_agg(t), '[]'::json)) from ( \
               select coalesce(ic.execution_location,'cloud') as plane, \
                      count(*) as calls, sum(coalesce(ic.cost_usd,0))::float8 as cost_usd \
                 from metering.inference_calls ic \
                where ic.tenant_id = $1 and ic.recorded_at >= now() - make_interval(days => $2) \
                  and ($3::uuid[] is null or ic.org_unit_id = any($3)) \
                group by coalesce(ic.execution_location,'cloud')) t"
        }
        _ => {
            "select json_build_object('rows', coalesce(json_agg(t), '[]'::json)) from ( \
               select served_model as model, provider, execution_location, \
                      sum(calls) as calls, sum(cost_usd)::float8 as cost_usd, sum(savings_usd)::float8 as savings_usd \
                 from metering.usage_daily \
                where tenant_id = $1 and day > current_date - $2 \
                  and ($3::uuid[] is null or org_unit_id = any($3)) \
                group by served_model, provider, execution_location) t"
        }
    };
    let data = match sqlx::query_scalar::<_, Value>(rows_sql)
        .bind(tenant)
        .bind(win.days)
        .bind(scope.bind())
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => v,
        Err(e) => return read_err("export", e),
    };
    let rows = data.get("rows").cloned().unwrap_or_else(|| json!([]));
    match q.format.as_deref().unwrap_or("json") {
        "csv" => {
            let csv = to_csv(&rows);
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/csv")],
                csv,
            )
                .into_response()
        }
        _ => (StatusCode::OK, Json(json!({ "rows": rows }))).into_response(),
    }
}

/// Flatten a JSON array of flat objects into CSV (header = union of keys, stable order).
fn to_csv(rows: &Value) -> String {
    let arr = match rows.as_array() {
        Some(a) if !a.is_empty() => a,
        _ => return String::new(),
    };
    let mut cols: Vec<String> = Vec::new();
    if let Some(obj) = arr[0].as_object() {
        cols.extend(obj.keys().cloned());
    }
    let esc = |s: &str| {
        if s.contains([',', '"', '\n']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    };
    let mut out = cols.join(",");
    for row in arr {
        out.push('\n');
        let line: Vec<String> = cols
            .iter()
            .map(|c| match row.get(c) {
                Some(Value::String(s)) => esc(s),
                Some(v) if !v.is_null() => v.to_string(),
                _ => String::new(),
            })
            .collect();
        out.push_str(&line.join(","));
    }
    out
}

// ── metric descriptor (A6) ────────────────────────────────────────────────────
/// O2 §4.2: the published, versioned metric descriptor. W1/W2/O3 clients render metric
/// labels + units FROM this, hardcoding no keys; adding a metric bumps `schema_version`
/// additively. Embedded so it ships with the binary.
const METRICS_DESCRIPTOR: &str = include_str!("../analytics-metrics.v1.json");

#[derive(Deserialize)]
pub struct MetricsQ {
    pub key: Option<String>,
}

/// `GET /v1/analytics/metrics[?key=…]` — the whole descriptor, or one metric. An unknown
/// key is `422` (§4.1 error surface) so a client can't render against a metric O2 doesn't
/// publish. Static schema (not tenant data), but mounted behind auth like the rest.
pub async fn get_metrics(Query(q): Query<MetricsQ>) -> Response {
    let doc: Value = serde_json::from_str(METRICS_DESCRIPTOR).expect("descriptor is valid JSON");
    match q.key {
        None => (StatusCode::OK, Json(doc)).into_response(),
        Some(k) => {
            let found = doc
                .get("metrics")
                .and_then(Value::as_array)
                .and_then(|a| a.iter().find(|m| m.get("key").and_then(Value::as_str) == Some(&k)))
                .cloned();
            match found {
                Some(m) => (StatusCode::OK, Json(m)).into_response(),
                None => (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(json!({ "error": "unknown_metric", "key": k })),
                )
                    .into_response(),
            }
        }
    }
}

#[cfg(test)]
mod descriptor {
    //! Contract test (A6): the descriptor is well-formed and every metric declares a valid
    //! unit + source — so a client rendering purely from it never hits an undefined key.
    use super::METRICS_DESCRIPTOR;
    use serde_json::Value;
    use std::collections::HashSet;

    #[test]
    fn descriptor_is_well_formed_and_units_are_valid() {
        let doc: Value = serde_json::from_str(METRICS_DESCRIPTOR).expect("valid JSON");
        assert!(doc["schema_version"].as_i64().is_some(), "schema_version present");
        let units: HashSet<&str> = ["usd", "ms", "percent", "ratio", "count"].into_iter().collect();
        let sources: HashSet<&str> = ["ledger", "quality-signal", "derived"].into_iter().collect();
        let metrics = doc["metrics"].as_array().expect("metrics array");
        assert!(!metrics.is_empty(), "at least one metric");
        let mut seen = HashSet::new();
        for m in metrics {
            let key = m["key"].as_str().expect("metric has a key");
            assert!(seen.insert(key), "duplicate metric key: {key}");
            let unit = m["unit"].as_str().unwrap_or("");
            let source = m["source"].as_str().unwrap_or("");
            assert!(units.contains(unit), "{key}: bad unit {unit:?}");
            assert!(sources.contains(source), "{key}: bad source {source:?}");
        }
        // The load-bearing keys the endpoints emit must be published.
        for required in ["cost_usd", "savings_usd", "cloud_equiv_usd", "share_pct", "calls"] {
            assert!(seen.contains(required), "descriptor missing required key: {required}");
        }
    }
}

#[cfg(test)]
mod gate {
    //! P12 acceptance gate — hits local Supabase (55322). Ignored by default:
    //!   cargo test -p torii-gateway --bin torii-gateway -- --ignored gate::p12
    //! Proves BOTH halves: (1) per-scope spend groups by the GH-5 denormalized column with
    //! NO recursive CTE (EXPLAIN-checked); (2) plane-split derives $0 local vs cloud savings
    //! from execution_location + the cheapest-cloud-step baseline.
    use super::{plane_split_sql, spend_sql};
    use crate::analytics::SpendGroup;
    use serde_json::Value;
    use sqlx::{postgres::PgPoolOptions, Row};
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

    fn approx(v: &Value, want: f64) -> bool {
        v.as_f64().map(|x| (x - want).abs() < 1e-9).unwrap_or(false)
    }

    /// Recursively scan a JSON doc for any object key that names prompt/response content or
    /// a credential — the no-secret-surface invariant (A8). Returns the first offending key.
    fn find_secret_key(v: &Value) -> Option<String> {
        const FORBIDDEN: [&str; 8] =
            ["content", "prompt", "response", "secret", "message", "body", "api_key", "token_text"];
        match v {
            Value::Object(m) => {
                for (k, val) in m {
                    let lk = k.to_lowercase();
                    if FORBIDDEN.iter().any(|f| lk.contains(f)) {
                        return Some(k.clone());
                    }
                    if let Some(hit) = find_secret_key(val) {
                        return Some(hit);
                    }
                }
                None
            }
            Value::Array(a) => a.iter().find_map(find_secret_key),
            _ => None,
        }
    }

    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn spend_by_tier_rolls_up_org_tree_and_plane_split_savings() {
        let pool = pool().await;
        let t = Uuid::new_v4();
        let team = Uuid::new_v4();
        let model = Uuid::new_v4();
        let chain = Uuid::new_v4();
        let cap_id: Uuid = sqlx::query_scalar("select id from catalog.capability_types limit 1")
            .fetch_one(&pool).await.expect("a seeded capability");
        let router_id: Uuid = sqlx::query_scalar("select id from catalog.routers limit 1")
            .fetch_one(&pool).await.expect("a seeded router");

        sqlx::query("insert into core.tenants (id, name, slug, modified_by) values ($1,'gate','gate-'||$1,'test')")
            .bind(t).execute(&pool).await.unwrap();
        // §D Phase 5: team as an org_unit (level 2) + its cap node. unit_levels seeded for the level FK.
        sqlx::query("insert into core.unit_levels (tenant_id, level, label) \
                     select $1, v.level, v.label from (values (0,'Organization'),(1,'Department'),(2,'Team'),(3,'Personal'),(4,'Service')) as v(level,label)")
            .bind(t).execute(&pool).await.unwrap();
        sqlx::query("insert into core.org_units (tenant_id, id, parent_id, level, name, is_personal, modified_by) \
                     values ($1,$2,null,2,'Gate Team',false,'test')")
            .bind(t).bind(team).execute(&pool).await.unwrap();
        sqlx::query("insert into governance.nodes (tenant_id, id, org_unit_id, cap_amount, enforcement, modified_by) \
                     values ($1,$2,$2,100,'hard','test')")
            .bind(t).bind(team).execute(&pool).await.unwrap();
        // priced cloud chain owned by the tenant → the local call's counterfactual
        sqlx::query("insert into catalog.models (id,name,version) values ($1,'gate-cloud','1')")
            .bind(model).execute(&pool).await.unwrap();
        sqlx::query("insert into catalog.model_endpoints (id,model_id,router_id,capability_id,endpoint_url,cost_per_input_token,cost_per_output_token,is_active) \
                     values (gen_random_uuid(),$1,$2,$3,'http://t',0.00001,0.00003,true)")
            .bind(model).bind(router_id).bind(cap_id).execute(&pool).await.unwrap();
        sqlx::query("insert into catalog.chains (id,tenant_id,name,capability_id,is_active,modified_by) \
                     values ($1,$2,'gate-chain',$3,true,'test')")
            .bind(chain).bind(t).bind(cap_id).execute(&pool).await.unwrap();
        sqlx::query("insert into catalog.chain_models (id,tenant_id,fallback_chain_id,router_id,model_id,sequence_order,plane,is_active,modified_by) \
                     values (gen_random_uuid(),$1,$2,$3,$4,1,'cloud',true,'test')")
            .bind(t).bind(chain).bind(router_id).bind(model).execute(&pool).await.unwrap();
        // ledger: 2 cloud calls + 1 local call, all attributed to the team unit (org_unit_id).
        for (id, plane, cost) in [
            (Uuid::new_v4(), "cloud", 0.01_f64),
            (Uuid::new_v4(), "cloud", 0.01),
            (Uuid::new_v4(), "local", 0.0),
        ] {
            sqlx::query(
                "insert into metering.inference_calls \
                   (tenant_id,id,capability,adapter,model,cost_usd,duration_ms,status,fallback_sequence, \
                    recorded_at,input_tokens,output_tokens,execution_location,chain_id,org_unit_id) \
                 values ($1,$2,'text_chat','anthropic','m',$3,100,'success',0,now(),512,128,$4::core.execution_location,'gate-chain',$5)")
                .bind(t).bind(id).bind(cost).bind(plane).bind(team)
                .execute(&pool).await.unwrap();
        }

        // ── gate half 1: spend by team, rolled up the org tree via the ancestor walk ──
        let spend: Value = sqlx::query_scalar(&spend_sql(SpendGroup::Team))
            .bind(t).bind(3650_i32).bind(None::<Vec<Uuid>>)
            .fetch_one(&pool).await.expect("spend query runs");
        let rows = spend["rows"].as_array().expect("rows array");
        let row = rows.iter().find(|r| r["node_id"] == team.to_string())
            .expect("a row for the team");
        assert_eq!(row["node_name"], "Gate Team");
        assert_eq!(row["calls"].as_i64(), Some(3), "3 calls attributed directly to the team");
        assert!(approx(&row["cost_usd"], 0.02), "cost = 2 cloud calls @0.01 = {}", row["cost_usd"]);
        assert!(approx(&row["savings_usd"], 0.00896), "savings from the local call = {}", row["savings_usd"]);

        // A7 scope filter (the `org_unit_id = any($3)` predicate): binding the team's
        // subtree keeps its row; binding a foreign node id yields no rows.
        let in_scope: Value = sqlx::query_scalar(&spend_sql(SpendGroup::Team))
            .bind(t).bind(3650_i32).bind(Some(vec![team]))
            .fetch_one(&pool).await.expect("scoped spend runs");
        assert!(in_scope["rows"].as_array().unwrap().iter().any(|r| r["node_id"] == team.to_string()),
                "in-scope node array keeps the team row");
        let out_scope: Value = sqlx::query_scalar(&spend_sql(SpendGroup::Team))
            .bind(t).bind(3650_i32).bind(Some(vec![Uuid::new_v4()]))
            .fetch_one(&pool).await.expect("out-of-scope spend runs");
        assert!(out_scope["rows"].as_array().unwrap().is_empty(),
                "out-of-scope node array yields no rows");

        // ── gate half 2: plane-split $0-local-vs-cloud savings from execution_location ──
        let ps: Value = sqlx::query_scalar(&plane_split_sql())
            .bind(t).bind(3650_i32).bind(None::<Vec<Uuid>>)
            .fetch_one(&pool).await.expect("plane-split query runs");
        assert_eq!(ps["local"]["calls"].as_i64(), Some(1));
        assert!(approx(&ps["local"]["cost_usd"], 0.0), "local cost is $0");
        assert!(ps["local"]["cloud_equiv_usd"].as_f64().unwrap() > 0.0, "local has a cloud counterfactual");
        assert_eq!(ps["cloud"]["calls"].as_i64(), Some(2));
        assert!(approx(&ps["savings_usd"], 0.00896), "savings = Σ cloud_equiv(local) = {}", ps["savings_usd"]);
        assert_eq!(ps["baseline"], "cheapest_cloud_in_chain");

        // §D LN-3c-2b (P12 reversal): spend-by-tier ROLLS UP the org tree via
        // core.org_unit_ancestor_at_level (the GH-5 *_node_id denorm cols were dropped). Add a personal
        // unit UNDER the team + a call attributed to it; the team's spend must now absorb it (the walk
        // maps a level-3 leaf up to its level-2 ancestor), while spend-by-user keeps it on the leaf.
        // (Placed after the plane-split gate so that gate keeps the pristine 2-cloud/1-local set.)
        let personal = Uuid::new_v4();
        sqlx::query("insert into core.org_units (tenant_id, id, parent_id, level, name, is_personal, modified_by) \
                     values ($1,$2,$3,3,'Gate Person',true,'test')")
            .bind(t).bind(personal).bind(team).execute(&pool).await.unwrap();
        sqlx::query("insert into metering.inference_calls \
                       (tenant_id,id,capability,adapter,model,cost_usd,duration_ms,status,fallback_sequence, \
                        recorded_at,input_tokens,output_tokens,execution_location,chain_id,org_unit_id) \
                     values ($1,$2,'text_chat','anthropic','m',0.03,100,'success',0,now(),10,5,'cloud'::core.execution_location,'gate-chain',$3)")
            .bind(t).bind(Uuid::new_v4()).bind(personal).execute(&pool).await.unwrap();

        let rolled: Value = sqlx::query_scalar(&spend_sql(SpendGroup::Team))
            .bind(t).bind(3650_i32).bind(None::<Vec<Uuid>>)
            .fetch_one(&pool).await.expect("rolled-up spend runs");
        let team_row = rolled["rows"].as_array().unwrap().iter().find(|r| r["node_id"] == team.to_string())
            .expect("team row after rollup");
        assert_eq!(team_row["calls"].as_i64(), Some(4), "team spend rolls up the personal-unit call (3 direct + 1 descendant)");
        assert!(approx(&team_row["cost_usd"], 0.05), "team cost absorbs the $0.03 personal call = {}", team_row["cost_usd"]);

        let by_user: Value = sqlx::query_scalar(&spend_sql(SpendGroup::User))
            .bind(t).bind(3650_i32).bind(None::<Vec<Uuid>>)
            .fetch_one(&pool).await.expect("spend-by-user runs");
        let user_rows = by_user["rows"].as_array().unwrap();
        assert!(user_rows.iter().any(|r| r["node_id"] == personal.to_string()),
                "the personal (level-3) call groups under the personal unit");
        assert!(!user_rows.iter().any(|r| r["node_id"] == team.to_string()),
                "the level-2 team is not a user-tier node (no level-3 ancestor → dropped)");

        // A8 no-secret-surface: the ledger-reading endpoints return only metadata — no key
        // anywhere in the response may name prompt/response content or a credential.
        for (name, doc) in [("spend", &spend), ("plane-split", &ps)] {
            if let Some(bad) = find_secret_key(doc) {
                panic!("{name} response exposes a content/secret key: {bad}");
            }
        }

        // cleanup — free the config FKs first, then cascade the tenant.
        for q in [
            "delete from metering.inference_calls where tenant_id=$1",
            "delete from catalog.chain_models where tenant_id=$1",
            "delete from catalog.chains where tenant_id=$1",
        ] { sqlx::query(q).bind(t).execute(&pool).await.unwrap(); }
        sqlx::query("delete from catalog.model_endpoints where model_id=$1").bind(model).execute(&pool).await.unwrap();
        sqlx::query("delete from catalog.models where id=$1").bind(model).execute(&pool).await.unwrap();
        sqlx::query("delete from core.tenants where id=$1").bind(t).execute(&pool).await.unwrap();
    }
}

#[cfg(test)]
mod scope_authz {
    //! A7 scope authz — hits local Supabase (55322). Ignored by default:
    //!   cargo test -p torii-gateway --bin torii-gateway -- --ignored scope_authz::
    //! Seeds an org→team→user budget tree and drives scope_filter_for directly (no auth
    //! stack): a member is confined to their own subtree; requesting a wider node is denied
    //! unless they hold audit.read; an audit.read holder is unrestricted.
    use super::{scope_filter_for, subtree_ids, ScopeErr};
    use crate::analytics::ScopeFilter;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    async fn pool() -> sqlx::PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new().max_connections(2).connect(&url).await.expect("connect 55322")
    }

    fn sorted(f: &ScopeFilter) -> Option<Vec<Uuid>> {
        match f {
            ScopeFilter::All => None,
            ScopeFilter::Nodes(v) => {
                let mut v = v.clone();
                v.sort();
                Some(v)
            }
        }
    }

    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn scope_confines_member_and_gates_wider_on_audit_read() {
        let pool = pool().await;
        let t = Uuid::new_v4();
        let (org, team, user) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let subject = Uuid::new_v4(); // the member's identity (user node ref_id)
        let outsider = Uuid::new_v4(); // an identity with no node

        sqlx::query("insert into core.tenants (id,name,slug,modified_by) values ($1,'sc','sc-'||$1,'test')")
            .bind(t).execute(&pool).await.unwrap();
        // §D Phase 5: the org tree is core.org_units; the member's identity maps to their PERSONAL
        // (level-3) unit via core.unit_members (replaces budget_nodes.ref_id). unit_levels seeded for
        // the level FK; a profiles row for the unit_members.profile_id FK.
        sqlx::query("insert into core.unit_levels (tenant_id, level, label) \
                     select $1, v.level, v.label from (values (0,'Organization'),(1,'Department'),(2,'Team'),(3,'Personal'),(4,'Service')) as v(level,label)")
            .bind(t).execute(&pool).await.unwrap();
        for (id, parent, level, name, personal) in [
            (org, None, 0_i32, "Org", false),
            (team, Some(org), 2, "Team", false),
            (user, Some(team), 3, "User", true),
        ] {
            sqlx::query("insert into core.org_units (tenant_id,id,parent_id,level,name,is_personal,modified_by) \
                         values ($1,$2,$3,$4,$5,$6,'test')")
                .bind(t).bind(id).bind(parent).bind(level).bind(name).bind(personal)
                .execute(&pool).await.unwrap();
        }
        sqlx::query("insert into core.profiles (id) values ($1) on conflict do nothing")
            .bind(subject).execute(&pool).await.unwrap();
        sqlx::query("insert into core.unit_members (tenant_id, unit_id, profile_id) values ($1,$2,$3)")
            .bind(t).bind(user).bind(subject).execute(&pool).await.unwrap();

        // subtree_ids: org → all three; team → {team,user}; user → {user}.
        let mut all3 = vec![org, team, user]; all3.sort();
        let mut tu = vec![team, user]; tu.sort();
        let mut got = subtree_ids(&pool, t, org).await.unwrap(); got.sort();
        assert_eq!(got, all3, "org subtree = org+team+user");
        let mut got = subtree_ids(&pool, t, team).await.unwrap(); got.sort();
        assert_eq!(got, tu, "team subtree = team+user");
        assert_eq!(subtree_ids(&pool, t, user).await.unwrap(), vec![user], "user subtree = self");

        // member (no audit.read), no scope → confined to own subtree = {user}.
        let f = scope_filter_for(&pool, t, subject, false, None).await.unwrap();
        assert_eq!(sorted(&f), Some(vec![user]), "member confined to own leaf subtree");

        // member requesting a WIDER node (their team) without audit.read → denied.
        let d = scope_filter_for(&pool, t, subject, false, Some(team)).await;
        assert!(matches!(d, Err(ScopeErr::Denied)), "wider scope without audit.read is denied");

        // member requesting their OWN node → allowed.
        let f = scope_filter_for(&pool, t, subject, false, Some(user)).await.unwrap();
        assert_eq!(sorted(&f), Some(vec![user]), "own node is allowed");

        // audit.read holder: unrestricted when unscoped; any subtree when scoped.
        let f = scope_filter_for(&pool, t, subject, true, None).await.unwrap();
        assert_eq!(f, ScopeFilter::All, "audit.read → tenant-wide");
        let f = scope_filter_for(&pool, t, subject, true, Some(team)).await.unwrap();
        assert_eq!(sorted(&f), Some(tu.clone()), "audit.read may scope to any subtree");

        // an identity with NO node and no audit.read → denied (no org-root fallback → no leak).
        let d = scope_filter_for(&pool, t, outsider, false, None).await;
        assert!(matches!(d, Err(ScopeErr::Denied)), "no personal node + no audit.read → denied");

        sqlx::query("delete from core.tenants where id=$1").bind(t).execute(&pool).await.unwrap();
    }
}
