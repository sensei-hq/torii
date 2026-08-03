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
//! `analytics_*` tables (kept current by the A2 triggers). Scope authz + the `analytics.view`
//! capability + `scope_node_id`-outside-subtree `403` are layered on in A7 — A5 is
//! tenant-scoped for any authenticated member.

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
    analytics::{Bucket, ExportReport, SpendGroup, Window},
    auth::Claims,
    capabilities::check_claims_version,
    state::SharedState,
};

/// Freshness gate + tenant resolution for an analytics read. A5 posture: any authenticated
/// member may read their tenant's analytics; A7 adds the `analytics.view` capability for
/// tenant-wide / cross-subtree scope and the `scope_node_id`-outside-subtree `403`.
async fn require_analytics(state: &SharedState, claims: &Claims) -> Result<Uuid, Response> {
    let tenant = claims
        .tenant_id
        .ok_or_else(|| (StatusCode::FORBIDDEN, "no active tenant").into_response())?;
    check_claims_version(&state.pool, claims)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, "stale token — re-authenticate").into_response())?;
    Ok(tenant)
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
const CE_LATERAL: &str = "left join lateral public.analytics_cloud_equiv( \
       ic.tenant_id, ic.chain_id, coalesce(ic.input_tokens,0), coalesce(ic.output_tokens,0)) ce \
     on coalesce(ic.execution_location,'cloud') = 'local'";

// ── overview ───────────────────────────────────────────────────────────────
pub async fn get_overview(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_analytics(&state, &claims).await {
        Ok(t) => t,
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
          (select cap_amount::float8 from public.budget_nodes \
             where tenant_id = $1 and parent_id is null order by cap_amount desc nulls last limit 1) as cap, \
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
        from public.analytics_usage_daily where tenant_id = $1) s";
    match sqlx::query_scalar::<_, Value>(q)
        .bind(tenant)
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
}

pub async fn get_cost_trend(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<TrendQ>,
) -> Response {
    let tenant = match require_analytics(&state, &claims).await {
        Ok(t) => t,
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
                        from public.analytics_usage_daily \
                       where tenant_id = $1 and day > current_date - $2 \
                       group by day) d) x) as series, \
          ( select round((100.0*((sum(cost_usd) filter (where day > current_date - ($2/2)) / nullif(sum(calls) filter (where day > current_date - ($2/2)),0)) \
                   - (sum(cost_usd) filter (where day <= current_date - ($2/2)) / nullif(sum(calls) filter (where day <= current_date - ($2/2)),0))) \
                   / nullif((sum(cost_usd) filter (where day <= current_date - ($2/2)) / nullif(sum(calls) filter (where day <= current_date - ($2/2)),0)),0))::numeric,1) \
              from public.analytics_usage_daily where tenant_id = $1 and day > current_date - $2) as delta \
        ) t";
    match sqlx::query_scalar::<_, Value>(sql)
        .bind(tenant)
        .bind(win.days)
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
}

pub async fn get_model_mix(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<WindowQ>,
) -> Response {
    let tenant = match require_analytics(&state, &claims).await {
        Ok(t) => t,
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
          from public.analytics_usage_daily \
         where tenant_id = $1 and day > current_date - $2 \
         group by served_model, provider, execution_location) t";
    match sqlx::query_scalar::<_, Value>(sql)
        .bind(tenant)
        .bind(win.days)
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
             from public.inference_calls ic {lat} \
            where ic.tenant_id = $1 \
              and ic.recorded_at >= now() - make_interval(days => $2) \
              and ($3::uuid is null or $3 in (ic.org_node_id, ic.dept_node_id, ic.team_node_id, ic.user_node_id, ic.budget_node_id)) \
              and ic.budget_node_id is not null) \
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
    let tenant = match require_analytics(&state, &claims).await {
        Ok(t) => t,
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
        .bind(q.scope_node_id)
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
    let col = group.column();
    let per_call = format!(
        "with pc as ( \
           select ic.{col} as grp, coalesce(ic.cost_usd,0) as cost_usd, {sav} as savings \
             from public.inference_calls ic {lat} \
            where ic.tenant_id = $1 \
              and ic.recorded_at >= now() - make_interval(days => $2) \
              and ($3::uuid is null or $3 in (ic.org_node_id, ic.dept_node_id, ic.team_node_id, ic.user_node_id, ic.budget_node_id)) \
              and ic.{col} is not null)",
        col = col, sav = SAVINGS_EXPR, lat = CE_LATERAL
    );
    if group.is_node() {
        format!(
            "{per_call} \
             select json_build_object('rows', coalesce(json_agg(t order by t.cost_usd desc), '[]'::json)) from ( \
               select (pc.grp)::text as node_id, bn.name as node_name, bn.kind, \
                      sum(pc.cost_usd)::float8 as cost_usd, count(*) as calls, sum(pc.savings)::float8 as savings_usd, \
                      bn.cap_amount::float8 as cap_usd, \
                      case when bn.cap_amount > 0 then round((100.0*sum(pc.cost_usd)/bn.cap_amount)::numeric,1)::float8 else null end as pct_of_cap \
                 from pc left join public.budget_nodes bn on bn.tenant_id = $1 and bn.id = (pc.grp)::uuid \
                group by pc.grp, bn.name, bn.kind, bn.cap_amount) t"
        )
    } else {
        format!(
            "{per_call} \
             select json_build_object('rows', coalesce(json_agg(t order by t.cost_usd desc), '[]'::json)) from ( \
               select (pc.grp)::text as node_id, (pc.grp)::text as node_name, null::text as kind, \
                      sum(pc.cost_usd)::float8 as cost_usd, count(*) as calls, sum(pc.savings)::float8 as savings_usd, \
                      null::float8 as cap_usd, null::float8 as pct_of_cap \
                 from pc group by pc.grp) t"
        )
    }
}

pub async fn get_spend(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<SpendQ>,
) -> Response {
    let tenant = match require_analytics(&state, &claims).await {
        Ok(t) => t,
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
        .bind(q.scope_node_id)
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
    let tenant = match require_analytics(&state, &claims).await {
        Ok(t) => t,
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
          from public.analytics_quality_daily \
         where tenant_id = $1 and day > current_date - $2 \
         group by served_model) t";
    match sqlx::query_scalar::<_, Value>(sql)
        .bind(tenant)
        .bind(win.days)
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
    let tenant = match require_analytics(&state, &claims).await {
        Ok(t) => t,
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
                 from public.inference_calls ic \
                where ic.tenant_id = $1 and ic.recorded_at >= now() - make_interval(days => $2) \
                group by coalesce(ic.execution_location,'cloud')) t"
        }
        _ => {
            "select json_build_object('rows', coalesce(json_agg(t), '[]'::json)) from ( \
               select served_model as model, provider, execution_location, \
                      sum(calls) as calls, sum(cost_usd)::float8 as cost_usd, sum(savings_usd)::float8 as savings_usd \
                 from public.analytics_usage_daily \
                where tenant_id = $1 and day > current_date - $2 \
                group by served_model, provider, execution_location) t"
        }
    };
    let data = match sqlx::query_scalar::<_, Value>(rows_sql)
        .bind(tenant)
        .bind(win.days)
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

    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn p12_gate_spend_no_recursion_and_plane_split_savings() {
        let pool = pool().await;
        let t = Uuid::new_v4();
        let team = Uuid::new_v4();
        let model = Uuid::new_v4();
        let chain = Uuid::new_v4();
        let cap_id: Uuid = sqlx::query_scalar("select id from config.capabilities limit 1")
            .fetch_one(&pool).await.expect("a seeded capability");
        let router_id: Uuid = sqlx::query_scalar("select id from config.routers limit 1")
            .fetch_one(&pool).await.expect("a seeded router");

        sqlx::query("insert into core.tenants (id, name, slug, modified_by) values ($1,'gate','gate-'||$1,'test')")
            .bind(t).execute(&pool).await.unwrap();
        sqlx::query("insert into public.budget_nodes (tenant_id, id, kind, name, cap_amount, modified_by) \
                     values ($1,$2,'team','Gate Team',100,'test')")
            .bind(t).bind(team).execute(&pool).await.unwrap();
        // priced cloud chain owned by the tenant → the local call's counterfactual
        sqlx::query("insert into config.models (id,name,version) values ($1,'gate-cloud','1')")
            .bind(model).execute(&pool).await.unwrap();
        sqlx::query("insert into config.model_endpoints (id,model_id,router_id,capability_id,endpoint_url,cost_per_input_token,cost_per_output_token,is_active) \
                     values (gen_random_uuid(),$1,$2,$3,'http://t',0.00001,0.00003,true)")
            .bind(model).bind(router_id).bind(cap_id).execute(&pool).await.unwrap();
        sqlx::query("insert into public.fallback_chains (id,tenant_id,name,capability_id,is_active,modified_by) \
                     values ($1,$2,'gate-chain',$3,true,'test')")
            .bind(chain).bind(t).bind(cap_id).execute(&pool).await.unwrap();
        sqlx::query("insert into public.fallback_chain_models (id,tenant_id,fallback_chain_id,router_id,model_id,sequence_order,plane,is_active,modified_by) \
                     values (gen_random_uuid(),$1,$2,$3,$4,1,'cloud',true,'test')")
            .bind(t).bind(chain).bind(router_id).bind(model).execute(&pool).await.unwrap();
        // ledger: 2 cloud calls + 1 local call, all attributed to the team (team_node_id set).
        for (id, plane, cost) in [
            (Uuid::new_v4(), "cloud", 0.01_f64),
            (Uuid::new_v4(), "cloud", 0.01),
            (Uuid::new_v4(), "local", 0.0),
        ] {
            sqlx::query(
                "insert into public.inference_calls \
                   (tenant_id,id,capability,adapter,model,cost_usd,duration_ms,status,fallback_sequence, \
                    recorded_at,input_tokens,output_tokens,execution_location,chain_id, \
                    budget_node_id,team_node_id) \
                 values ($1,$2,'text_chat','anthropic','m',$3,100,'success',0,now(),512,128,$4,'gate-chain',$5,$5)")
                .bind(t).bind(id).bind(cost).bind(plane).bind(team)
                .execute(&pool).await.unwrap();
        }

        // ── gate half 1: spend by team, grouped by the denormalized column ──
        let spend: Value = sqlx::query_scalar(&spend_sql(SpendGroup::Team))
            .bind(t).bind(3650_i32).bind(None::<Uuid>)
            .fetch_one(&pool).await.expect("spend query runs");
        let rows = spend["rows"].as_array().expect("rows array");
        let row = rows.iter().find(|r| r["node_id"] == team.to_string())
            .expect("a row for the team");
        assert_eq!(row["node_name"], "Gate Team");
        assert_eq!(row["calls"].as_i64(), Some(3), "3 calls attributed to the team");
        assert!(approx(&row["cost_usd"], 0.02), "cost = 2 cloud calls @0.01 = {}", row["cost_usd"]);
        assert!(approx(&row["savings_usd"], 0.00896), "savings from the local call = {}", row["savings_usd"]);

        // EXPLAIN must show NO recursive CTE (the whole point of GH-5 denormalization).
        let explain = format!("explain {}", spend_sql(SpendGroup::Team));
        let plan: String = sqlx::query(&explain)
            .bind(t).bind(3650_i32).bind(None::<Uuid>)
            .fetch_all(&pool).await.expect("explain runs")
            .iter().map(|r| r.get::<String, _>(0)).collect::<Vec<_>>().join("\n");
        assert!(!plan.to_lowercase().contains("recursive"),
                "spend-by-scope must not use a recursive CTE:\n{plan}");

        // ── gate half 2: plane-split $0-local-vs-cloud savings from execution_location ──
        let ps: Value = sqlx::query_scalar(&plane_split_sql())
            .bind(t).bind(3650_i32).bind(None::<Uuid>)
            .fetch_one(&pool).await.expect("plane-split query runs");
        assert_eq!(ps["local"]["calls"].as_i64(), Some(1));
        assert!(approx(&ps["local"]["cost_usd"], 0.0), "local cost is $0");
        assert!(ps["local"]["cloud_equiv_usd"].as_f64().unwrap() > 0.0, "local has a cloud counterfactual");
        assert_eq!(ps["cloud"]["calls"].as_i64(), Some(2));
        assert!(approx(&ps["savings_usd"], 0.00896), "savings = Σ cloud_equiv(local) = {}", ps["savings_usd"]);
        assert_eq!(ps["baseline"], "cheapest_cloud_in_chain");

        // cleanup — free the config FKs first, then cascade the tenant.
        for q in [
            "delete from public.inference_calls where tenant_id=$1",
            "delete from public.fallback_chain_models where tenant_id=$1",
            "delete from public.fallback_chains where tenant_id=$1",
        ] { sqlx::query(q).bind(t).execute(&pool).await.unwrap(); }
        sqlx::query("delete from config.model_endpoints where model_id=$1").bind(model).execute(&pool).await.unwrap();
        sqlx::query("delete from config.models where id=$1").bind(model).execute(&pool).await.unwrap();
        sqlx::query("delete from core.tenants where id=$1").bind(t).execute(&pool).await.unwrap();
    }
}
