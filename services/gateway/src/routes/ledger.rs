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
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use gateway::store::GatewayStore;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::Claims,
    capabilities::{check_claims_version, CapabilitySet},
    state::SharedState,
    store::PgGatewayStore,
};

/// Freshness gate + capability check for a read; returns the caller's tenant.
async fn require_read(
    state: &SharedState,
    claims: &Claims,
    capability: &str,
) -> Result<Uuid, Box<Response>> {
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
async fn require_member(state: &SharedState, claims: &Claims) -> Result<Uuid, Box<Response>> {
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

/// The lifecycle values a runs page can be filtered to: the `runs.run_status` enum, plus
/// `unscheduled` for a run whose charge exists before the driver has written a schedule row.
/// That last one is a real state a charge-only run is in, not an absence to be spelled `null` in
/// a query string.
const RUN_STATUS_FILTERS: [&str; 6] = [
    "waking",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "unscheduled",
];

/// The filter value that means "no schedule row yet" (see [`RUN_STATUS_FILTERS`]).
const UNSCHEDULED: &str = RUN_STATUS_FILTERS[5];

/// A validated keyset position: the last row of the previous page, identified the way the ledger
/// orders rows. Both halves travel together — a timestamp alone cannot say WHICH of the runs
/// admitted in that microsecond was the last one, so a lone half is refused rather than guessed.
#[derive(Clone, Copy, Debug, PartialEq)]
struct RunCursor {
    before: DateTime<Utc>,
    before_id: Uuid,
}

/// `GET /v1/runs` query — the shared page limit plus the two things that make an unbounded ledger
/// navigable: a keyset cursor and a lifecycle filter.
///
/// Deliberately not [`Paging`]: these parameters mean nothing to `/v1/requests` or `/v1/audit`, and
/// accepting them there would let a caller believe they had filtered a page they had not.
#[derive(Deserialize)]
pub struct RunsQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    /// the `submitted_at` of the previous page's last row (RFC 3339 — the shape the read serves).
    #[serde(default)]
    pub before: Option<String>,
    /// that row's `run_id`: the cursor's tiebreak half.
    #[serde(default)]
    pub before_id: Option<Uuid>,
    /// `waking | paused | completed | failed | cancelled | unscheduled`. Omitted = every run.
    #[serde(default)]
    pub status: Option<String>,
    /// `true` = only runs with at least one failed CALL. Omitted or `false` = every run.
    ///
    /// A separate axis from `status` on purpose: a run can complete while one of its calls
    /// failed and a fallback answered (that is what the fallback chain is for), so "runs that
    /// ended badly" and "runs something failed inside" are different questions and neither can
    /// be spelled with the other.
    #[serde(default)]
    pub failed_calls: Option<String>,
}

impl RunsQuery {
    fn limit(&self) -> i64 {
        clamp_limit(self.limit)
    }

    /// The cursor, or the reason it cannot be used. `before` is parsed here rather than by serde so
    /// a malformed cursor is a 400 that names the problem instead of a deserialization error no
    /// operator can act on.
    fn cursor(&self) -> Result<Option<RunCursor>, String> {
        match (self.before.as_deref(), self.before_id) {
            (None, None) => Ok(None),
            (Some(ts), Some(before_id)) => DateTime::parse_from_rfc3339(ts)
                .map(|at| {
                    Some(RunCursor {
                        before: at.with_timezone(&Utc),
                        before_id,
                    })
                })
                .map_err(|_| format!("before={ts} is not an RFC 3339 timestamp")),
            _ => Err(
                "before and before_id travel together — pass both halves of the cursor, or neither"
                    .into(),
            ),
        }
    }

    /// The failed-calls filter. Only `true`/`false` are accepted — deliberately, and for the same
    /// reason an unknown status is refused: a flag we quietly dropped would serve every run to an
    /// operator who asked to narrow, and the widening is invisible on a table.
    fn failed_calls(&self) -> Result<bool, String> {
        match self
            .failed_calls
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => Ok(false),
            Some("true") => Ok(true),
            Some("false") => Ok(false),
            Some(s) => Err(format!(
                "failed_calls={s} is not a flag — pass failed_calls=true to see only runs with a \
                 failed call, or leave it out for every run"
            )),
        }
    }

    /// The lifecycle filter, or the reason a caller-supplied status is not one. An unknown value is
    /// rejected rather than returning an empty page: "no runs" and "no such status" read
    /// identically to an operator looking at a table.
    fn status(&self) -> Result<Option<&str>, String> {
        match self
            .status
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => Ok(None),
            Some(s) if RUN_STATUS_FILTERS.contains(&s) => Ok(Some(s)),
            Some(s) => Err(format!(
                "unknown status '{s}' — one of: {}",
                RUN_STATUS_FILTERS.join(", ")
            )),
        }
    }
}

/// `GET /v1/audit?limit=N` — recent audit events for the caller's tenant.
pub async fn get_audit(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(p): Query<Paging>,
) -> Response {
    let tenant = match require_read(&state, &claims, "audit.read").await {
        Ok(t) => t,
        Err(resp) => return *resp,
    };
    // Build the JSON array in-DB (avoids per-row mapping); tenant-scoped + capped.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from ( \
           select id, actor_id, action, target_type, target_id, created_at \
             from audit.audit_events_for_tenant where tenant_id = $1 \
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

/// The ledger row shape both reads serve, in one place. `/v1/requests` and a single run's call
/// list are the same row seen at two scopes, so they must project the same columns — a run
/// detail that quietly omitted one would let the same call read differently on two screens.
const LEDGER_COLUMNS: &str = "\
           id, chain_id, adapter, model, capability, budget_node_id, \
           execution_location, input_tokens, output_tokens, \
           cost_usd::float8 as cost_usd, \
           duration_ms, status, fallback_sequence, recorded_at, \
           run_id";

/// Upstream from `get_requests`: one tenant's recent calls as a JSON array, read straight off
/// the `requests_ledger_for_tenant` shield. Split out so the DB test below can assert what the
/// read path really returns — the projection lives in SQL, so a test over a Rust struct would
/// not cover the part that can drift (a column missing from this list is invisible to callers).
async fn requests_page(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    limit: i64,
) -> Result<Value, sqlx::Error> {
    let sql = format!(
        "select coalesce(json_agg(t order by t.recorded_at desc), '[]'::json) from ( \
           select {LEDGER_COLUMNS} \
             from metering.requests_ledger_for_tenant where tenant_id = $1 \
            order by recorded_at desc limit $2) t"
    );
    sqlx::query_scalar(&sql)
        .bind(tenant)
        .bind(limit)
        .fetch_one(pool)
        .await
}

/// Every call one run made, newest first — the same shield and the same projection as
/// `requests_page`, scoped to `run_id`.
///
/// Deliberately uncapped: a page limit exists on `/v1/requests` because the tenant's whole
/// ledger is unbounded, but a single run's calls are the finite set the run bought. Capping
/// here would silently truncate the run's own spend, which is the one number the screen exists
/// to get right.
async fn run_calls(pool: &sqlx::PgPool, tenant: Uuid, run_id: Uuid) -> Result<Value, sqlx::Error> {
    let sql = format!(
        "select coalesce(json_agg(t order by t.recorded_at desc), '[]'::json) from ( \
           select {LEDGER_COLUMNS} \
             from metering.requests_ledger_for_tenant \
            where tenant_id = $1 and run_id = $2 \
            order by recorded_at desc) t"
    );
    sqlx::query_scalar(&sql)
        .bind(tenant)
        .bind(run_id)
        .fetch_one(pool)
        .await
}

/// One run's accounting header, as JSON: lifecycle, both money figures, the unit it was charged
/// to, and its calls' totals. Split from its FROM clause so the detail and the list project the
/// SAME object — a run that read differently in a list than on its own screen would be two
/// truths about one charge.
///
/// `runs.run_charges` anchors the read: it is the run's accounting identity — every admitted
/// run has one, capped or not — and it is where the charged units live. The registry
/// (`runs.runs`) and the schedule (`runs.scheduled_runs`) are LEFT JOINed because the driver
/// owns those rows and a charge is legible before (or after) them; a missing schedule is a
/// run with no lifecycle to report, not a missing run.
///
/// Attribution repeats the store's own rule — the DEEPEST charged `core.org_units` row among
/// `node_ids` (see `torii_core::metering`) — so the unit a screen names for a run is the unit
/// the store stamped its calls with. Two rules here would mean a run "charged to" one unit
/// while its rows roll up to another.
///
/// `totals` is aggregated over the SAME ledger predicate as the call list, so the header can
/// never disagree with the table beneath it. `booked_usd` is a different figure on purpose —
/// see [`get_run`].
const RUN_HEADER_PROJECTION: &str = r#"json_build_object(
             'run_id', c.run_id,
             'status', s.status::text,
             'reason', s.reason,
             'submitted_at', coalesce(r.created_at, c.created_at),
             'updated_at', s.updated_at,
             'settled', c.settled,
             'limit_usd', c.limit_micro_usd::float8 / 1000000,
             'booked_usd', c.recorded_micro_usd::float8 / 1000000,
             'attributed_to', case when ou.id is null then null else json_build_object(
                                'id', ou.id, 'name', ou.name,
                                'level', ou.level, 'level_label', ou.level_label) end,
             'totals', (select json_build_object(
                               'calls', count(*),
                               'failed', count(*) filter (where l.status <> 'success'),
                               'cost_usd', coalesce(sum(l.cost_usd), 0)::float8,
                               'input_tokens', coalesce(sum(l.input_tokens), 0),
                               'output_tokens', coalesce(sum(l.output_tokens), 0))
                          from metering.requests_ledger_for_tenant l
                         where l.tenant_id = c.tenant_id and l.run_id = c.run_id))"#;

/// The FROM/JOIN clause behind [`RUN_HEADER_PROJECTION`]; callers append a WHERE. The aliases
/// (`c`, `r`, `s`, `ou`) and `coalesce(r.created_at, c.created_at)` are therefore part of the
/// contract between the two reads below.
const RUN_HEADER_FROM: &str = r#"
           from runs.run_charges c
           left join runs.runs r
             on r.tenant_id = c.tenant_id and r.run_id = c.run_id
           left join runs.scheduled_runs s
             on s.tenant_id = c.tenant_id and s.run_id = c.run_id
           left join lateral (
             select ou.id, ou.name, ou.level, ul.label as level_label
               from core.org_units ou
               left join core.unit_levels ul
                 on ul.tenant_id = ou.tenant_id and ul.level = ou.level
              where ou.tenant_id = c.tenant_id and ou.id = any (c.node_ids)
              order by ou.level desc, ou.id
              limit 1) ou on true"#;

/// One run's header, or `None` when this tenant has no charge row for the id.
async fn run_detail(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    run_id: Uuid,
) -> Result<Option<Value>, sqlx::Error> {
    let sql = format!(
        "select {RUN_HEADER_PROJECTION} {RUN_HEADER_FROM} \
          where c.tenant_id = $1 and c.run_id = $2"
    );
    sqlx::query_scalar(&sql)
        .bind(tenant)
        .bind(run_id)
        .fetch_optional(pool)
        .await
}

/// One page of the tenant's runs, newest first — the same header the detail serves, so the list
/// is a place to START rather than a second source of truth. Anchored on the charge like
/// `run_detail`, which is the honest definition of "a run exists": admission is when it began
/// spending, so a run the driver has not yet scheduled appears here with a null status — the truth
/// about it — instead of waiting to exist.
///
/// `has_more` is about the ledger, not the page: it says rows exist older than the last one here,
/// so the caller can offer to walk back without promising something the read cannot show.
struct RunsPage {
    rows: Vec<Value>,
    has_more: bool,
}

/// The tenant's runs, newest first, from either its newest page or the page below `cursor`, and
/// narrowed to `status` when the caller asked for one and to runs with a failed call when
/// `failed_only` is set. The two narrow together: a lifecycle chip and the failures toggle are
/// separate questions, so answering both is an intersection, not a choice between them.
async fn runs_page(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    limit: i64,
    cursor: Option<RunCursor>,
    status: Option<&str>,
    failed_only: bool,
) -> Result<RunsPage, sqlx::Error> {
    // The inner ORDER BY is what makes LIMIT mean "the newest N"; the ORDER BY inside json_agg
    // is what makes the array ordered at all (an aggregate without one has no order to promise).
    //
    // The tiebreak runs the SAME direction as the timestamp so the cursor is one record
    // comparison; a mixed-direction sort would need an OR of two predicates to express the same
    // position, and the two spellings are exactly the kind of thing that drifts.
    //
    // The status filter is SQL's job, not the caller's: filtering a page in the client could only
    // ever filter what happened to be ON that page, which for a filtered ledger is a different
    // set of runs than the tenant has.
    //
    // The failures filter is an EXISTS over the same ledger predicate the header counts with, so a
    // row that shows "(2 failed)" is a row this filter selects — one expression, not two that can
    // drift into disagreeing about what a failed call is.
    let sql = format!(
        "select coalesce(json_agg(t.h order by t.submitted desc, t.run_id desc), '[]'::json) \
           from (select {RUN_HEADER_PROJECTION} as h, \
                        coalesce(r.created_at, c.created_at) as submitted, c.run_id \
                 {RUN_HEADER_FROM} \
                  where c.tenant_id = $1 \
                    and ($2::timestamptz is null \
                         or (coalesce(r.created_at, c.created_at), c.run_id) \
                            < ($2::timestamptz, $3::uuid)) \
                    and ($4::text is null \
                         or case when $4::text = '{UNSCHEDULED}' then s.status is null \
                                 else s.status::text = $4::text end) \
                    and (not $5::boolean \
                         or exists (select 1 \
                                      from metering.requests_ledger_for_tenant f \
                                     where f.tenant_id = c.tenant_id \
                                       and f.run_id = c.run_id \
                                       and f.status <> 'success')) \
                  order by submitted desc, c.run_id desc \
                  limit $6) t"
    );
    let rows: Value = sqlx::query_scalar(&sql)
        .bind(tenant)
        .bind(cursor.map(|c| c.before))
        .bind(cursor.map(|c| c.before_id))
        .bind(status)
        .bind(failed_only)
        .bind(limit + 1)
        .fetch_one(pool)
        .await?;
    let mut rows = rows.as_array().cloned().unwrap_or_default();
    // One row more than asked for is how the read knows there is an older page: the alternative is
    // offering "older runs" and answering that click with an empty table.
    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    Ok(RunsPage { rows, has_more })
}

/// `GET /v1/runs/{id}` — one orchestrator run as the ledger records it: its lifecycle (from the
/// schedule row), what it spent, the unit it was charged to, and every call it made. Capability
/// `audit.read`; the queries are tenant-scoped, so another tenant's run id is a 404 rather than
/// a peek at their data.
///
/// Two money figures, deliberately. `booked_usd` (`run_charges.recorded_micro_usd`) is what
/// governance has actually charged to the run's budget nodes — the number Budgets & billing
/// shows — and it is a watermark that moves when the run settles, so on a live run it reads 0
/// while the calls already cost money. `totals.cost_usd` is the sum of those calls' own prices
/// and is always current. §9.4 kept both rather than picking one: the discontinuity exists in
/// the accounting, and hiding it on the one screen that shows a run's spend would just move the
/// surprise to the budget page.
pub async fn get_run(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Response {
    let tenant = match require_read(&state, &claims, "audit.read").await {
        Ok(t) => t,
        Err(resp) => return *resp,
    };
    let run = match run_detail(&state.pool, tenant, id).await {
        Ok(Some(run)) => run,
        Ok(None) => return (StatusCode::NOT_FOUND, "no such run").into_response(),
        Err(e) => {
            tracing::error!("get_run: header: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    };
    match run_calls(&state.pool, tenant, id).await {
        Ok(calls) => (StatusCode::OK, Json(json!({ "run": run, "calls": calls }))).into_response(),
        Err(e) => {
            tracing::error!("get_run: calls: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/runs?limit=N&status=&before=&before_id=` — the tenant's runs, newest first: each run's
/// lifecycle, its spend (booked and priced), and the unit it was charged to. Capability
/// `audit.read`.
///
/// The row is the run detail's own header, so opening a run from here shows the same numbers.
/// `limit` is clamped like every other ledger page — runs are unbounded over time — and the
/// tenant filter is applied server-side, so another tenant's runs are simply not in the page.
///
/// `status`, `failed_calls` and `before`/`before_id` are all applied server-side for the same
/// reason the tenant filter is. A page is bounded, the ledger is not, so a filter applied to the
/// page would answer a different question than the operator asked. `failed_calls=true` narrows to
/// runs with at least one failed call — which is not the same set as `status=failed`, since a run
/// that fell back and finished is successful as a run and explicable only by its calls. A
/// malformed cursor, an unknown status or a flag that is not a flag is a 400 carrying the reason —
/// never a quietly different page that looks like "this tenant has no failed runs".
pub async fn get_runs(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(p): Query<RunsQuery>,
) -> Response {
    let tenant = match require_read(&state, &claims, "audit.read").await {
        Ok(t) => t,
        Err(resp) => return *resp,
    };
    let cursor = match p.cursor() {
        Ok(c) => c,
        Err(why) => return (StatusCode::BAD_REQUEST, why).into_response(),
    };
    let status = match p.status() {
        Ok(s) => s,
        Err(why) => return (StatusCode::BAD_REQUEST, why).into_response(),
    };
    let failed_only = match p.failed_calls() {
        Ok(f) => f,
        Err(why) => return (StatusCode::BAD_REQUEST, why).into_response(),
    };
    match runs_page(&state.pool, tenant, p.limit(), cursor, status, failed_only).await {
        Ok(page) => (
            StatusCode::OK,
            Json(json!({ "runs": page.rows, "has_more": page.has_more })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("get_runs: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/requests?limit=N` — recent inference calls (cost/latency/attribution), including
/// the orchestrator run each call was made inside (`run_id`; null for chat and the judge).
pub async fn get_requests(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(p): Query<Paging>,
) -> Response {
    let tenant = match require_read(&state, &claims, "audit.read").await {
        Ok(t) => t,
        Err(resp) => return *resp,
    };
    match requests_page(&state.pool, tenant, clamp_limit(p.limit)).await {
        Ok(requests) => (StatusCode::OK, Json(json!({ "requests": requests }))).into_response(),
        Err(e) => {
            tracing::error!("get_requests: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/requests/{id}/trace` — the per-call routing trace for one inference call: the
/// ordered attempt chain (adapter → model, status, duration, and the error that triggered
/// each fallback) that explains WHY a given model answered. Capability `audit.read`; the
/// store filters by the caller's tenant, so one tenant can never read another's trace.
/// Returns `{ "trace": null }` when no trace was recorded for the id (calls that predate
/// the trace write, or a best-effort trace write that failed) — never a 404 for a real row.
pub async fn get_request_trace(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Response {
    let tenant = match require_read(&state, &claims, "audit.read").await {
        Ok(t) => t,
        Err(resp) => return *resp,
    };
    let store = PgGatewayStore {
        pool: state.pool.clone(),
        tenant_id: tenant,
    };
    match store.get_traces_by_call(id).await {
        // Rows come back recorded_at ASC; there is one trace per call today, so the last is
        // the most recent. `pop()` yields None (→ null) when the call has no trace.
        Ok(mut traces) => {
            let trace = traces.pop().map(|t| t.trace);
            (StatusCode::OK, Json(json!({ "trace": trace }))).into_response()
        }
        Err(e) => {
            tracing::error!("get_request_trace: {e}");
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
        Err(resp) => return *resp,
    };
    let nodes: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.kind), '[]'::json) from ( \
           select id, parent_id, kind, name, \
                  cap_amount::float8 as cap_amount, spent_amount::float8 as spent_amount, \
                  reserved_amount::float8 as reserved_amount, enforcement, period, \
                  alert_threshold::float8 as alert_threshold, free_floor_enabled \
             from governance.budget_tree_for_tenant where tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    let requests: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from ( \
           select id, node_id, requested_by, requested_cap::float8 as requested_cap, \
                  reason, status, created_at \
             from governance.budget_requests_for_tenant where tenant_id = $1 and status = 'pending') t",
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
        Err(resp) => return *resp,
    };
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from ( \
           select id, prefix, profile_id, service_account_id, scope, status, \
                  last_used_at, created_at \
             from core.apikeys_for_tenant where tenant_id = $1) t",
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
    // §D §B: reads through the keyvault.connections_for_tenant shield view (booleans/timestamps
    // only — ciphertext is structurally absent). The view is tenant-filtered here; json shape,
    // column order, and `order by name` are preserved so the /v1/connections payload is byte-stable
    // across the Phase 2 router_credentials → keyvault deny-all move.
    sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.name), '[]'::json) from ( \
           select name, api_base_url, is_active, requires_key, \
                  connected, connected_at, oauth_connected, oauth_connected_at \
             from keyvault.connections_for_tenant \
            where tenant_id = $1) t",
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
        Err(resp) => return *resp,
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
        Err(resp) => return *resp,
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
           select key, domain, description from core.permissions) t",
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
        Err(resp) => return *resp,
    };
    // Catalog is global (catalog.models); enablement is per-tenant and DERIVED from chain
    // membership (§D Phase 3) — a model is `enabled` iff it appears in the tenant's resolved+viable
    // chains (chains_for_tenant). `reachable` (has any endpoint) stays a separate catalog fact.
    // System One Phase 5 adds `chains`: WHICH chains carry the model, not just whether one does.
    // Membership is the reason a model is enabled, and a `decide` chain means the model answers
    // typed decision calls rather than chat — a fact the model row itself does not carry.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.provider, t.display_name), '[]'::json) from ( \
           select m.full_name, m.display_name, m.description, m.context_window, \
                  m.max_output_tokens, m.released_on, m.deprecated_on, \
                  coalesce(p.name, 'unknown') as provider, \
                  exists(select 1 from catalog.model_endpoints e where e.model_id = m.id) as reachable, \
                  exists(select 1 from catalog.chains_for_tenant cft \
                          where cft.tenant_id = $1 and cft.model_id = m.id) as enabled, \
                  (select coalesce(json_agg(distinct cft.chain_name), '[]'::json) \
                     from catalog.chains_for_tenant cft \
                    where cft.tenant_id = $1 and cft.model_id = m.id) as chains \
             from catalog.models m \
             left join catalog.providers p on p.id = m.provider_id \
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
        Err(resp) => return *resp,
    };
    // §D Phase 3: the CHAT models a member may call = the DISTINCT models in the tenant's
    // resolved+viable chains FOR THE CHAT CAPABILITY (chains_for_tenant already applies
    // tenant-override resolution + the keyless-safe key-config filter; a model reaches a chain only
    // via a configured model_endpoint, so the old endpoint EXISTS is subsumed). The capability
    // filter is preserved — this powers Compare's cloud columns, which are chat-only.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.provider, t.display_name), '[]'::json) from ( \
           select distinct cft.model_full_name as full_name, \
                  coalesce(cft.model_display_name, cft.model_full_name) as display_name, \
                  coalesce(cft.provider, 'unknown') as provider \
             from catalog.chains_for_tenant cft \
             join catalog.models m on m.id = cft.model_id \
             join catalog.capability_types c on c.id = cft.capability_id \
            where cft.tenant_id = $1 \
              and c.name = 'chat' \
              and m.deprecated_on is null) t",
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
        Err(resp) => return *resp,
    };
    let build = async {
        // servers visible to the tenant; effective enabled = tenant override else default.
        let servers: Value = sqlx::query_scalar(
            "select coalesce(json_agg(t order by t.scope, t.name), '[]'::json) from ( \
               select s.id, s.name, s.label, s.transport, s.scope, \
                      coalesce(tms.enabled, s.enabled) as enabled \
                 from device.mcp_servers s \
                 left join device.tenant_mcp_servers tms \
                   on tms.mcp_server_id = s.id and tms.tenant_id = $1 \
                where s.scope = 'platform' or s.tenant_id = $1) t",
        )
        .bind(tenant)
        .fetch_one(&state.pool)
        .await?;
        let tools: Value = sqlx::query_scalar(
            "select coalesce(json_agg(t order by t.tool_name), '[]'::json) from ( \
               select mt.id, mt.mcp_server_id, mt.tool_name \
                 from device.mcp_server_tools mt \
                 join device.mcp_servers s on s.id = mt.mcp_server_id \
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
                 from device.tool_allow_lists where tenant_id = $1 and space_id is null) t",
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

/// `GET /v1/devices` — O3-4 device fleet read model. Any authenticated member may read;
/// without `device.manage` they see only their **own** devices, with it the whole tenant
/// fleet (mirrors the `devices_access` RLS policy — the gateway pool runs as service_role
/// and bypasses RLS, so the own-vs-manage scope is reproduced in the query). Each row
/// carries a `buffer_verdict` (O3 §3.3, NULL-safe until D4-8 populates `buffer_health`) and
/// a `drifted` flag (last-synced `config_version` vs the tenant current); the operator stale
/// threshold is surfaced once at the top level. `public_key`/token material is never
/// projected. `status='revoked'` cuts a device's access on the auth hot path
/// (auth::finish_authed) even with a still-live token; revoke it via `/rpc/devices/revoke`.
pub async fn get_devices(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_member(&state, &claims).await {
        Ok(t) => t,
        Err(resp) => return *resp,
    };
    let actor = match Uuid::parse_str(&claims.sub) {
        Ok(a) => a,
        Err(_) => return (StatusCode::UNAUTHORIZED, "bad subject").into_response(),
    };
    // own-vs-manage: `device.manage` → whole tenant fleet; else only the caller's devices.
    let has_manage = match CapabilitySet::resolve(&state.pool, &claims).await {
        Ok(caps) => caps.require("device.manage").is_ok(),
        Err(e) => {
            tracing::error!("get_devices: capability resolve: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let own_only: Option<Uuid> = if has_manage { None } else { Some(actor) };

    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.last_seen_at desc nulls last), '[]'::json) from ( \
           select d.id, d.name, d.platform, d.app_version, d.config_version, d.status, \
                  d.enrolled_at, d.last_seen_at, d.sync_policy, d.buffer_health, \
                  d.owner, d.tenant_config_version \
             from device.devices_for_tenant d \
            where d.tenant_id = $1 and ($2::uuid is null or d.profile_id = $2)) t",
    )
    .bind(tenant)
    .bind(own_only)
    .fetch_one(&state.pool)
    .await;

    let mut devices = match rows {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("get_devices: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    };

    // Enrich each row with the buffer-health verdict + config-drift flag. Computed in Rust so
    // the stale threshold stays an operator env constant and the logic is unit-tested
    // (crate::devices); the SQL stays the field-shape authority.
    let threshold = crate::devices::stale_threshold_s();
    let now = Utc::now();
    if let Value::Array(list) = &mut devices {
        for row in list.iter_mut() {
            let verdict = crate::devices::buffer_verdict(row.get("buffer_health"), now, threshold);
            let dv = row.get("config_version").and_then(Value::as_i64);
            let tv = row.get("tenant_config_version").and_then(Value::as_i64);
            let drifted = crate::devices::is_drifted(dv, tv);
            if let Value::Object(obj) = row {
                obj.insert("buffer_verdict".into(), Value::from(verdict));
                obj.insert("drifted".into(), Value::from(drifted));
            }
        }
    }

    (
        StatusCode::OK,
        Json(json!({ "devices": devices, "stale_threshold_s": threshold })),
    )
        .into_response()
}

/// `GET /v1/routing` — the tenant's fallback chains as ordered steps
/// (router → model, sequence, plane). Capability `chain.read`. Frontend groups by chain.
pub async fn get_routing(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let tenant = match require_read(&state, &claims, "chain.read").await {
        Ok(t) => t,
        Err(resp) => return *resp,
    };
    // Read the BASE table (not effective_chain_models, which filters is_active=true) so
    // disabled steps are shown and can be re-enabled. Includes the step id for the toggle.
    // §System One Phase 5: a chain carries a CAPABILITY, and it changes what a step means —
    // the `decide` chain's models answer typed questions, not chat. Without it the screen
    // labelled a decision chain "Routing" like any other and the reader had no way to tell
    // which chains feed `/v1/chat` and which feed a `Select` decision.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.chain_name, t.sequence_order), '[]'::json) from ( \
           select fcm.id, fc.name as chain_name, ct.name as capability, \
                  fcm.sequence_order, fcm.plane, fcm.is_active, \
                  coalesce(r.name, '—') as router, \
                  coalesce(m.full_name, '—') as model \
             from catalog.chain_models fcm \
             join catalog.chains fc on fc.id = fcm.fallback_chain_id \
             join catalog.capability_types ct on ct.id = fc.capability_id \
             left join catalog.models m on m.id = fcm.model_id \
             left join catalog.routers r on r.id = fcm.router_id \
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

#[derive(Deserialize)]
pub struct RankingQuery {
    /// Which chain axis to resolve the ranking against. Defaults to `decision` (System One):
    /// the rankings are measurements of decision models, and the chain that carries them is
    /// the tenant's `decide` chain. Chat models have no measured ranking store.
    #[serde(default)]
    pub capability: Option<String>,
}

/// `GET /v1/rankings` — the measured ranking store as an operator sees it (§System One
/// Phase 5). Capability `model.manage` (a platform-quality surface, not a member one).
///
/// One entry per benchmark CATEGORY (whatever the artifacts measured), each carrying:
/// - the verdict and the reason the resolver would or would not send an order, from
///   `catalog.ranking_status` — the same function the resolver's data comes from, so the
///   screen cannot describe a different decision than the gateway makes;
/// - the rows the tenant's chain would offer, from `catalog.ranked_chain`: rank, accuracy,
///   the CI half-width, whether the row is within the margin, and the provenance
///   (revision, artifact_sha, corpus_sha, generated_at);
/// - the policy rows that apply to the category (`platform` default and the tenant's own
///   override, if any), so the edit form can show what is configured rather than what is
///   effective — `effective_margin` is the greater of that and the top model's CI
///   half-width, and the two are not the same number.
///
/// Rows with no chain step still come back: an empty `rows` with `chained: 0` is the
/// "no model on your chain is measured" case, and it must be visible as such rather than
/// rendering as an empty page.
pub async fn get_rankings(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<RankingQuery>,
) -> Response {
    let tenant = match require_read(&state, &claims, "model.manage").await {
        Ok(t) => t,
        Err(resp) => return *resp,
    };
    let capability = q.capability.unwrap_or_else(|| "decision".into());
    // Resolve the capability name against the catalog, so a typo is a 400 rather than an
    // empty ranking that looks like "this tenant measured nothing".
    let known: Result<Option<i32>, _> =
        sqlx::query_scalar("select 1 from catalog.capability_types where name = $1 limit 1")
            .bind(&capability)
            .fetch_optional(&state.pool)
            .await;
    match known {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (StatusCode::BAD_REQUEST, "unknown capability").into_response();
        }
        Err(e) => {
            tracing::error!("get_rankings: capability lookup: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    }

    let categories: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.category), '[]'::json) from ( \
           select s.category, s.capability, s.verdict, s.effective_margin, s.policy_revision, \
                  s.chained, s.measured, s.admissible, s.ranking_revision, \
                  s.artifact_sha, s.corpus_sha, s.generated_at, s.proxy, s.reason, \
                  (select coalesce(json_agg(r order by r.rank nulls last, r.sequence_order), \
                                    '[]'::json) \
                     from catalog.ranked_chain($1, $2, c.category) r) as rows \
             from (select distinct category from catalog.model_rankings) c \
             cross join lateral catalog.ranking_status($1, $2, c.category) s) t",
    )
    .bind(tenant)
    .bind(&capability)
    .fetch_one(&state.pool)
    .await;
    let categories = match categories {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("get_rankings: categories: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    };

    // Both scopes, flat: the UI decides precedence with a pure helper, and a platform row
    // stays visible when a tenant override shadows it — "override 0.05 (default 0.03)" is
    // more useful to an operator than 0.05 alone.
    let policies: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.category, t.is_default desc), '[]'::json) from ( \
           select p.category, (p.tenant_id is null) as is_default, p.margin, \
                  p.revision, p.modified_at, p.modified_by \
             from catalog.ranking_policies p \
            where p.tenant_id = $1 or p.tenant_id is null) t",
    )
    .bind(tenant)
    .fetch_one(&state.pool)
    .await;
    match policies {
        Ok(policies) => (
            StatusCode::OK,
            Json(json!({
                "capability": capability,
                "categories": categories,
                "policies": policies,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("get_rankings: policies: {e}");
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
        Err(resp) => return *resp,
    };
    // §D Phase 4: reads through the feature_governance_for_tenant shield (governance.features ×
    // the resolved workspace feature_policies state). The shield exposes `slug` over the
    // feature_key→feature_id fold, so this read is unchanged in shape (byte-stable payload).
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.sequence), '[]'::json) from ( \
           select slug, title, description, purpose, enabled, mandatory, sequence, \
                  policy_state \
             from governance.feature_governance_for_tenant \
            where tenant_id = $1) t",
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
        Err(resp) => return *resp,
    };
    // §D Phase 4: /v1/settings reads the workspace toggles via the settings_for_tenant shield
    // (governance.settings absorbed tenant_settings) — {setting_key, enabled} contract preserved.
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.setting_key), '[]'::json) from ( \
           select setting_key, enabled from governance.settings_for_tenant where tenant_id = $1) t",
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
            sqlx::query_scalar("select id from catalog.routers where name = 'openai'")
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
            "insert into keyvault.router_credentials \
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

#[cfg(test)]
mod trace_roundtrip {
    //! Hits local Supabase (55322). Ignored by default — run with:
    //!   `cargo test -- --ignored trace_persists_and_is_tenant_isolated`
    use crate::store::PgGatewayStore;
    use chrono::Utc;
    use gateway::store::{CallStatus, GatewayStore, InferenceCall, StoredTrace};
    use gateway::types::capability::Capability;
    use gateway::types::trace::{Attempt, AttemptStatus, ExecutionTrace, TraceStatus};
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

    fn attempt(
        sequence: u8,
        adapter: &str,
        model: &str,
        status: AttemptStatus,
        error: Option<&str>,
        fallback_triggered: bool,
    ) -> Attempt {
        Attempt {
            sequence,
            adapter: adapter.into(),
            model: model.into(),
            api_model_id: model.into(),
            status,
            duration_ms: 15,
            tokens: None,
            cost: None,
            error: error.map(|e| e.to_string()),
            fallback_triggered,
        }
    }

    /// A trace persisted for a call round-trips through the live JSONB column with its attempt
    /// chain intact, is fetchable by call id via the store, and is tenant-isolated (tenant B
    /// can't read tenant A's trace) — exactly what `GET /v1/requests/{id}/trace` relies on.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn trace_persists_and_is_tenant_isolated() {
        let pool = pool().await;
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        for t in [a, b] {
            sqlx::query(
                "insert into core.tenants (id, name, slug, modified_by) \
                 values ($1, 'trace-test', $2, 'trace-test')",
            )
            .bind(t)
            .bind(format!("trace-test-{t}"))
            .execute(&pool)
            .await
            .unwrap();
        }
        let store_a = PgGatewayStore {
            pool: pool.clone(),
            tenant_id: a,
        };
        let store_b = PgGatewayStore {
            pool: pool.clone(),
            tenant_id: b,
        };

        // a real inference_call row for tenant A (subject_id None → attribution cols NULL).
        let call_id = Uuid::new_v4();
        let call = InferenceCall {
            id: call_id,
            session_id: None,
            project_id: None,
            subject_id: None,
            tier: None,
            capability: Capability::TextChat,
            chain_id: Some("chat".into()),
            adapter: "ollama".into(),
            model: "gemma2:2b".into(),
            api_model_id: Some("gemma2:2b".into()),
            input_tokens: Some(10),
            output_tokens: Some(20),
            cost_usd: 0.0,
            cost_estimated: None,
            duration_ms: 900,
            status: CallStatus::Success,
            error_type: None,
            fallback_sequence: 2,
            recorded_at: Utc::now(),
            run_id: None,
        };
        store_a
            .insert_inference_call(&call)
            .await
            .expect("insert call");

        let trace = ExecutionTrace {
            request_id: call_id.to_string(),
            capability: Capability::TextChat,
            status: TraceStatus::Success,
            duration_ms: 900,
            candidates: Vec::new(),
            skipped: Vec::new(),
            attempts: vec![
                attempt(
                    1,
                    "anthropic",
                    "claude-sonnet-4-5",
                    AttemptStatus::Failed,
                    Some("429 rate limited"),
                    true,
                ),
                attempt(
                    2,
                    "ollama",
                    "gemma2:2b",
                    AttemptStatus::Success,
                    None,
                    false,
                ),
            ],
            estimated_cost: None,
            actual_cost: None,
            created_at: Utc::now(),
            routing: None,
        };
        let stored = StoredTrace {
            id: Uuid::new_v4(),
            inference_call_id: Some(call_id),
            trace,
            created_at: Utc::now(),
        };
        store_a
            .insert_execution_trace(&stored)
            .await
            .expect("insert trace");

        // tenant A reads it back with the attempt chain intact.
        let got = store_a.get_traces_by_call(call_id).await.expect("read A");
        assert_eq!(got.len(), 1, "exactly one trace for the call");
        let t = &got[0].trace;
        assert_eq!(t.attempts.len(), 2);
        assert_eq!(t.attempts[0].status, AttemptStatus::Failed);
        assert_eq!(t.attempts[0].error.as_deref(), Some("429 rate limited"));
        assert_eq!(t.attempts[1].adapter, "ollama");
        assert!(matches!(t.status, TraceStatus::Success));

        // tenant B must never see tenant A's trace (the core isolation property).
        let none = store_b.get_traces_by_call(call_id).await.expect("read B");
        assert!(none.is_empty(), "tenant B must not read tenant A's trace");

        // cleanup — `on delete cascade` clears inference_calls + execution_traces with the tenant.
        for t in [a, b] {
            sqlx::query("delete from core.tenants where id = $1")
                .bind(t)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
}

#[cfg(test)]
mod requests_read {
    //! Hits local Supabase (55322). Ignored by default — run with:
    //!   `cargo test -- --ignored run_attributed_call_reaches_the_requests_read`
    use super::requests_page;
    use crate::store::PgGatewayStore;
    use chrono::Utc;
    use gateway::store::{CallStatus, GatewayStore, InferenceCall};
    use gateway::types::capability::Capability;
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

    /// One ledger row as the executor writes it: `subject_id` None so the store resolves the
    /// attributed unit from the run's charge (the path a real run takes), `run_id` Some only
    /// when the call was made inside a run.
    fn call(id: Uuid, run_id: Option<Uuid>) -> InferenceCall {
        InferenceCall {
            id,
            session_id: None,
            project_id: None,
            subject_id: None,
            tier: None,
            capability: Capability::TextChat,
            chain_id: Some("chat".into()),
            adapter: "ollama".into(),
            model: "gemma2:2b".into(),
            api_model_id: Some("gemma2:2b".into()),
            input_tokens: Some(11),
            output_tokens: Some(4),
            cost_usd: 0.0,
            cost_estimated: None,
            duration_ms: 700,
            status: CallStatus::Success,
            error_type: None,
            fallback_sequence: 1,
            recorded_at: Utc::now(),
            run_id,
        }
    }

    /// A call made inside a run is readable at `/v1/requests` WITH that run id (and the run's
    /// charged unit), a call made outside one still reads with a null id — never a fabricated
    /// one — and neither leaks to another tenant. This is the read half of §9.2: the stance is
    /// only worth anything if an operator can get from a run's spend back to the rows that
    /// bought it, which means the column must survive the shield view and the SQL projection.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn run_attributed_call_reaches_the_requests_read() {
        let pool = pool().await;
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        for t in [a, b] {
            sqlx::query(
                "insert into core.tenants (id, name, slug, modified_by) \
                 values ($1, 'requests-read-test', $2, 'requests-read-test')",
            )
            .bind(t)
            .bind(format!("requests-read-{t}"))
            .execute(&pool)
            .await
            .unwrap();
        }

        // Tenant A's org root + its governance node — the unit a run's spend is charged to and
        // therefore the unit its calls must be attributed to.
        sqlx::query(
            "insert into core.unit_levels (tenant_id, level, label) \
             select $1, v.level, v.label from (values (0,'Organization'),(1,'Department'), \
                                                (2,'Team'),(3,'Personal'),(4,'Service')) \
             as v(level, label) on conflict do nothing",
        )
        .bind(a)
        .execute(&pool)
        .await
        .unwrap();
        let org: Uuid = sqlx::query_scalar(
            "insert into core.org_units (tenant_id, parent_id, level, name, is_personal, modified_by) \
             values ($1, null, 0, 'Organization', false, 'requests-read-test') returning id",
        )
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into governance.nodes (tenant_id, id, org_unit_id, cap_amount, enforcement, modified_by) \
             values ($1, $2, $2, null, 'hard', 'requests-read-test')",
        )
        .bind(a)
        .bind(org)
        .execute(&pool)
        .await
        .unwrap();

        let run = Uuid::new_v4();
        sqlx::query(
            "insert into runs.run_charges (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd) \
             values ($1, $2, $3, array[$4]::uuid[], 0)",
        )
        .bind(a)
        .bind(run)
        .bind(Uuid::new_v4())
        .bind(org)
        .execute(&pool)
        .await
        .unwrap();

        let store = PgGatewayStore {
            pool: pool.clone(),
            tenant_id: a,
        };
        let in_run = Uuid::new_v4();
        let bare = Uuid::new_v4();
        store
            .insert_inference_call(&call(in_run, Some(run)))
            .await
            .expect("insert run call");
        store
            .insert_inference_call(&call(bare, None))
            .await
            .expect("insert chat call");

        let rows = requests_page(&pool, a, 50).await.expect("read A");
        let rows = rows.as_array().expect("requests array");
        let find = |id: Uuid| {
            rows.iter()
                .find(|r| r["id"] == id.to_string())
                .cloned()
                .expect("row present in the page")
        };

        let run_row = find(in_run);
        assert_eq!(
            run_row["run_id"],
            run.to_string(),
            "a run's call must carry its run id to the read path"
        );
        assert_eq!(
            run_row["budget_node_id"],
            org.to_string(),
            "the run's charged unit is the attribution the row reads back"
        );

        let bare_row = find(bare);
        assert!(
            bare_row["run_id"].is_null(),
            "a call outside a run has no run id — not a fabricated one"
        );

        // The page is the caller's tenant only; tenant B sees none of A's rows.
        let other = requests_page(&pool, b, 50).await.expect("read B");
        assert!(
            other.as_array().expect("requests array").is_empty(),
            "tenant B must not see tenant A's calls"
        );

        // cleanup — `on delete cascade` clears inference_calls with the tenant.
        for t in [a, b] {
            sqlx::query("delete from core.tenants where id = $1")
                .bind(t)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
}

#[cfg(test)]
mod run_detail_read {
    //! Hits local Supabase (55322). Ignored by default — run with:
    //!   `cargo test -- --ignored run_detail_reads_its_calls_and_attribution`
    use super::{run_calls, run_detail, runs_page, RunCursor, RunsQuery};
    use crate::store::PgGatewayStore;
    use chrono::Utc;
    use gateway::store::{CallStatus, GatewayStore, InferenceCall};
    use gateway::types::capability::Capability;
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

    fn call(id: Uuid, run_id: Option<Uuid>, status: CallStatus, cost_usd: f64) -> InferenceCall {
        InferenceCall {
            id,
            session_id: None,
            project_id: None,
            subject_id: None,
            tier: None,
            capability: Capability::TextChat,
            chain_id: Some("chat".into()),
            adapter: "ollama".into(),
            model: "gemma2:2b".into(),
            api_model_id: Some("gemma2:2b".into()),
            input_tokens: Some(10),
            output_tokens: Some(5),
            cost_usd,
            cost_estimated: None,
            duration_ms: 400,
            status,
            error_type: None,
            fallback_sequence: 1,
            recorded_at: Utc::now(),
            run_id,
        }
    }

    async fn tenant(pool: &sqlx::PgPool) -> Uuid {
        let t = Uuid::new_v4();
        sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) \
             values ($1, 'runs-page-test', $2, 'runs-page-test')",
        )
        .bind(t)
        .bind(format!("runs-page-{t}"))
        .execute(pool)
        .await
        .unwrap();
        t
    }

    /// Paging and filtering over the run ledger, proved against the real schema.
    ///
    /// Walking back with `before`/`before_id` must visit every run exactly once — including two
    /// admitted in the same microsecond, which is the case the cursor's tiebreak half exists for —
    /// and `has_more` must say when to stop instead of promising a page that is not there. The
    /// filter must narrow the WHOLE ledger: a lifecycle filter that only narrowed the page in hand
    /// would report a slice of the run history as the whole of it.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn runs_page_walks_back_and_filters() {
        let pool = pool().await;
        let t = tenant(&pool).await;

        // Seven charges, newest first, one of them never scheduled and the last two admitted in
        // the same microsecond. Minutes-ago keeps the ordering explicit rather than clock-dependent.
        let seeded: [(Uuid, i32, Option<&str>); 7] = [
            (Uuid::new_v4(), 1, Some("completed")),
            (Uuid::new_v4(), 2, Some("failed")),
            (Uuid::new_v4(), 3, Some("completed")),
            (Uuid::new_v4(), 4, None),
            (Uuid::new_v4(), 5, Some("paused")),
            (Uuid::new_v4(), 6, Some("completed")),
            (Uuid::new_v4(), 6, Some("completed")),
        ];
        for (run, minutes_ago, status) in &seeded {
            sqlx::query(
                "insert into runs.runs (tenant_id, run_id, format_version, created_at) \
                 values ($1, $2, 1, now() - make_interval(mins => $3))",
            )
            .bind(t)
            .bind(run)
            .bind(minutes_ago)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "insert into runs.run_charges \
                   (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd, \
                    created_at, settled) \
                 values ($1, $2, $3, '{}'::uuid[], 0, now() - make_interval(mins => $4), true)",
            )
            .bind(t)
            .bind(run)
            .bind(Uuid::new_v4())
            .bind(minutes_ago)
            .execute(&pool)
            .await
            .unwrap();
            if let Some(s) = status {
                sqlx::query(
                    "insert into runs.scheduled_runs (tenant_id, run_id, graph, status) \
                     values ($1, $2, '{}'::jsonb, $3::runs.run_status)",
                )
                .bind(t)
                .bind(run)
                .bind(s)
                .execute(&pool)
                .await
                .unwrap();
            }
        }
        let ids: Vec<Uuid> = seeded.map(|(id, ..)| id).to_vec();

        // Walk back a page at a time. The cursor is built from the rows the read served —
        // `submitted_at` and `run_id` are already in each header, so the client never needs the
        // gateway to echo a cursor back at it.
        let mut seen: Vec<Uuid> = vec![];
        let mut cursor = None;
        let mut pages = 0;
        loop {
            let page = runs_page(&pool, t, 3, cursor, None, false)
                .await
                .expect("read a page");
            assert!(page.rows.len() <= 3, "limit bounds the page");
            for row in &page.rows {
                seen.push(row["run_id"].as_str().unwrap().parse().unwrap());
            }
            pages += 1;
            assert!(pages < 10, "paging must terminate");
            if !page.has_more {
                break;
            }
            let last = page.rows.last().expect("a page with more has a last row");
            cursor = Some(RunCursor {
                before: last["submitted_at"].as_str().unwrap().parse().unwrap(),
                before_id: last["run_id"].as_str().unwrap().parse().unwrap(),
            });
        }
        assert_eq!(pages, 3, "seven runs three at a time is three pages");
        assert_eq!(&seen[..5], &ids[..5], "every page is newest first");
        let (mut tie_seen, mut tie_expected) = (seen[5..].to_vec(), ids[5..].to_vec());
        tie_seen.sort();
        tie_expected.sort();
        assert_eq!(
            tie_seen, tie_expected,
            "both runs admitted in the same microsecond are served once each — never skipped, never twice"
        );

        // A filter narrows the ledger, not the page: with `limit 1` the second page must still find
        // the other matching run rather than reporting it as the end of the history.
        let first = runs_page(&pool, t, 1, None, Some("completed"), false)
            .await
            .expect("filtered page");
        assert_eq!(first.rows.len(), 1);
        assert!(first.has_more, "four completed runs exist, not one");
        let last = &first.rows[0];
        let next = runs_page(
            &pool,
            t,
            10,
            Some(RunCursor {
                before: last["submitted_at"].as_str().unwrap().parse().unwrap(),
                before_id: last["run_id"].as_str().unwrap().parse().unwrap(),
            }),
            Some("completed"),
            false,
        )
        .await
        .expect("filtered second page");
        assert_eq!(next.rows.len(), 3, "the filter spans the whole ledger");
        assert!(!next.has_more);
        for row in &next.rows {
            assert_eq!(row["status"], "completed");
        }

        // `unscheduled` is the charge-only run — a real state, not a missing value — and the other
        // statuses match only their own rows.
        let unscheduled = runs_page(&pool, t, 10, None, Some("unscheduled"), false)
            .await
            .expect("unscheduled filter");
        assert_eq!(unscheduled.rows.len(), 1);
        assert_eq!(unscheduled.rows[0]["run_id"], ids[3].to_string());
        assert_eq!(
            unscheduled.rows[0]["status"],
            Value::Null,
            "a run with no schedule row has no lifecycle to report"
        );
        let failed = runs_page(&pool, t, 10, None, Some("failed"), false)
            .await
            .expect("failed filter");
        assert_eq!(failed.rows.len(), 1);
        assert_eq!(failed.rows[0]["run_id"], ids[1].to_string());

        // cleanup — the tenant cascade clears the registry, schedules and charges.
        sqlx::query("delete from core.tenants where id = $1")
            .bind(t)
            .execute(&pool)
            .await
            .unwrap();
    }

    /// The failures toggle, proved against the real schema — the reason it is not `status=failed`.
    ///
    /// A run that fell back and finished is `completed` as a run while one of its calls failed;
    /// the operator asking "which runs had something fail inside" cannot reach it through the
    /// lifecycle at all. So the filter has to read the calls, and what it selects has to be the
    /// same set whose rows already print `(N failed)` — one predicate, or the table and the filter
    /// start disagreeing about what a failed call is.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn runs_page_filters_to_runs_with_failed_calls() {
        let pool = pool().await;
        let t = tenant(&pool).await;

        // Four runs, newest first. A completed one that fell back (A) is the case status cannot
        // express; B is completed with only successful calls; C is a run that failed outright;
        // D has no calls at all, which is not the same as having none that failed.
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let c = Uuid::new_v4();
        let d = Uuid::new_v4();
        let seeded: [(Uuid, i32, &str); 4] = [
            (a, 1, "completed"),
            (b, 2, "completed"),
            (c, 3, "failed"),
            (d, 4, "completed"),
        ];
        for (run, minutes_ago, status) in seeded {
            sqlx::query(
                "insert into runs.runs (tenant_id, run_id, format_version, created_at) \
                 values ($1, $2, 1, now() - make_interval(mins => $3))",
            )
            .bind(t)
            .bind(run)
            .bind(minutes_ago)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "insert into runs.run_charges \
                   (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd, \
                    created_at, settled) \
                 values ($1, $2, $3, '{}'::uuid[], 0, now() - make_interval(mins => $4), true)",
            )
            .bind(t)
            .bind(run)
            .bind(Uuid::new_v4())
            .bind(minutes_ago)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "insert into runs.scheduled_runs (tenant_id, run_id, graph, status) \
                 values ($1, $2, '{}'::jsonb, $3::runs.run_status)",
            )
            .bind(t)
            .bind(run)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        }

        for (run, status) in [(a, "success"), (a, "failed"), (b, "success"), (c, "failed")] {
            sqlx::query(
                "insert into metering.inference_calls \
                   (tenant_id, id, capability, adapter, model, duration_ms, status, \
                    fallback_sequence, run_id) \
                 values ($1, $2, 'text_chat', 'anthropic', 'claude-sonnet-4-5', 10, \
                         $3::metering.call_status, 1, $4)",
            )
            .bind(t)
            .bind(Uuid::new_v4())
            .bind(status)
            .bind(run)
            .execute(&pool)
            .await
            .unwrap();
        }

        let ids = |page: &super::RunsPage| -> Vec<Uuid> {
            page.rows
                .iter()
                .map(|r| r["run_id"].as_str().unwrap().parse().unwrap())
                .collect()
        };

        let with_failures = runs_page(&pool, t, 10, None, None, true)
            .await
            .expect("failed-calls page");
        assert_eq!(
            ids(&with_failures),
            vec![a, c],
            "A completed but fell back; C failed outright; B and D had no failed call"
        );
        // the rows the filter selects are the rows whose own header reports a failure — the count
        // and the selection come from the same predicate.
        for row in &with_failures.rows {
            assert!(
                row["totals"]["failed"].as_i64().unwrap() > 0,
                "a selected row reports the failure it was selected for: {row}"
            );
        }

        // Composed with the lifecycle, not instead of it: "completed runs in which something
        // failed" is A alone — B is completed and clean, C failed as a run.
        let completed = runs_page(&pool, t, 10, None, Some("completed"), true)
            .await
            .expect("composed filter");
        assert_eq!(ids(&completed), vec![a]);

        // A filter still pages: two matches one at a time is a page, then the other, then the end.
        let first = runs_page(&pool, t, 1, None, None, true)
            .await
            .expect("first filtered page");
        assert_eq!(ids(&first), vec![a]);
        assert!(first.has_more, "C is still below A");
        let last = &first.rows[0];
        let second = runs_page(
            &pool,
            t,
            5,
            Some(RunCursor {
                before: last["submitted_at"].as_str().unwrap().parse().unwrap(),
                before_id: last["run_id"].as_str().unwrap().parse().unwrap(),
            }),
            None,
            true,
        )
        .await
        .expect("second filtered page");
        assert_eq!(ids(&second), vec![c]);
        assert!(!second.has_more, "nothing older has a failed call");

        // And without the flag the filter is absent, not "surprisingly narrow".
        let all = runs_page(&pool, t, 10, None, None, false)
            .await
            .expect("unfiltered page");
        assert_eq!(ids(&all), vec![a, b, c, d]);

        sqlx::query("delete from core.tenants where id = $1")
            .bind(t)
            .execute(&pool)
            .await
            .unwrap();
    }

    /// The query's own validation, with no database: a cursor wearing one half is refused rather
    /// than quietly served as the first page, and a status nothing carries is refused rather than
    /// served as an empty page that reads like "this tenant has no failed runs".
    #[test]
    fn runs_query_refuses_a_partial_cursor_and_an_unknown_status() {
        let q = |before: Option<&str>, before_id: Option<Uuid>, status: Option<&str>| RunsQuery {
            limit: Some(10),
            before: before.map(str::to_string),
            before_id,
            status: status.map(str::to_string),
            failed_calls: None,
        };
        let id = Uuid::new_v4();
        assert_eq!(q(None, None, None).cursor().unwrap(), None);
        assert!(q(Some("2026-10-26T09:00:00Z"), Some(id), None)
            .cursor()
            .unwrap()
            .is_some());
        for half in [
            q(Some("2026-10-26T09:00:00Z"), None, None),
            q(None, Some(id), None),
        ] {
            let why = half.cursor().expect_err("half a cursor is ambiguous");
            assert!(why.contains("before_id"), "the refusal names both halves");
        }
        let why = q(Some("yesterday"), Some(id), None)
            .cursor()
            .expect_err("a cursor has to be a timestamp");
        assert!(why.contains("yesterday"), "{why}");

        assert_eq!(q(None, None, None).status().unwrap(), None);
        assert_eq!(
            q(None, None, Some("  ")).status().unwrap(),
            None,
            "blank is no filter, not an unknown status"
        );
        assert_eq!(
            q(None, None, Some("unscheduled")).status().unwrap(),
            Some("unscheduled")
        );
        let why = q(None, None, Some("nope"))
            .status()
            .expect_err("an unknown status is refused");
        assert!(why.contains("unknown status 'nope'"), "{why}");
        assert!(
            why.contains("cancelled"),
            "the refusal lists what works: {why}"
        );

        // The failures flag is a flag or it is refused. A dropped value would widen the page back
        // to every run — a narrowing the operator asks for must never silently become no filter.
        let flag = |v: Option<&str>| RunsQuery {
            limit: Some(10),
            before: None,
            before_id: None,
            status: None,
            failed_calls: v.map(str::to_string),
        };
        assert!(!flag(None).failed_calls().unwrap(), "omitted = no filter");
        assert!(
            !flag(Some("  ")).failed_calls().unwrap(),
            "blank = no filter"
        );
        assert!(!flag(Some("false")).failed_calls().unwrap());
        assert!(flag(Some("true")).failed_calls().unwrap());
        let why = flag(Some("yes"))
            .failed_calls()
            .expect_err("a word that is not a flag is refused");
        assert!(why.contains("failed_calls=yes"), "{why}");
        assert!(
            why.contains("failed_calls=true"),
            "the refusal says what works: {why}"
        );
    }

    /// The run detail screen's one query per fact, proved against the real schema: a run's calls
    /// are its own (not the tenant's other traffic), the unit it is attributed to is the DEEPEST
    /// charged node — the same unit the store stamped those calls with — and another tenant gets
    /// nothing for the same id. It also pins the two money figures §9.4 kept apart: `booked_usd`
    /// is the charge watermark (what governance has booked), `totals.cost_usd` is the sum of the
    /// calls themselves, and they legitimately differ.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn run_detail_reads_its_calls_and_attribution() {
        let pool = pool().await;
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        for t in [a, b] {
            sqlx::query(
                "insert into core.tenants (id, name, slug, modified_by) \
                 values ($1, 'run-detail-test', $2, 'run-detail-test')",
            )
            .bind(t)
            .bind(format!("run-detail-{t}"))
            .execute(&pool)
            .await
            .unwrap();
        }

        // Tenant A's org: a root and a team hung off it. The charge carries BOTH (the issuer's
        // units plus their ancestors), so "the run's unit" is a real resolution, not a lookup of
        // whatever happened to be first in the array.
        sqlx::query(
            "insert into core.unit_levels (tenant_id, level, label) \
             select $1, v.level, v.label from (values (0,'Organization'),(2,'Team')) \
             as v(level, label)",
        )
        .bind(a)
        .execute(&pool)
        .await
        .unwrap();
        let org: Uuid = sqlx::query_scalar(
            "insert into core.org_units (tenant_id, parent_id, level, name, is_personal, modified_by) \
             values ($1, null, 0, 'Organization', false, 'run-detail-test') returning id",
        )
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        let team: Uuid = sqlx::query_scalar(
            "insert into core.org_units (tenant_id, parent_id, level, name, is_personal, modified_by) \
             values ($1, $2, 2, 'Platform', false, 'run-detail-test') returning id",
        )
        .bind(a)
        .bind(org)
        .fetch_one(&pool)
        .await
        .unwrap();

        // The run: a registry row, a terminal schedule row, and a settled charge of $2 against
        // the two nodes with $0.75 booked so far.
        let run = Uuid::new_v4();
        sqlx::query("insert into runs.runs (tenant_id, run_id, format_version) values ($1, $2, 1)")
            .bind(a)
            .bind(run)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "insert into runs.scheduled_runs (tenant_id, run_id, graph, status) \
             values ($1, $2, '{}'::jsonb, 'completed'::runs.run_status)",
        )
        .bind(a)
        .bind(run)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into runs.run_charges \
               (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd, \
                recorded_micro_usd, settled) \
             values ($1, $2, $3, array[$4, $5]::uuid[], 2000000, 750000, true)",
        )
        .bind(a)
        .bind(run)
        .bind(Uuid::new_v4())
        .bind(org)
        .bind(team)
        .execute(&pool)
        .await
        .unwrap();

        // Two calls inside the run (one failed, and a failed call costs nothing) plus one chat
        // call outside it, which must never appear on the run.
        let store = PgGatewayStore {
            pool: pool.clone(),
            tenant_id: a,
        };
        let ok = Uuid::new_v4();
        let failed = Uuid::new_v4();
        store
            .insert_inference_call(&call(ok, Some(run), CallStatus::Success, 0.25))
            .await
            .expect("insert served call");
        store
            .insert_inference_call(&call(failed, Some(run), CallStatus::Failed, 0.0))
            .await
            .expect("insert failed call");
        store
            .insert_inference_call(&call(Uuid::new_v4(), None, CallStatus::Success, 0.10))
            .await
            .expect("insert chat call");

        let header = run_detail(&pool, a, run)
            .await
            .expect("read header")
            .expect("the run's charge exists");
        assert_eq!(
            header["status"], "completed",
            "lifecycle comes from the schedule row"
        );
        assert_eq!(header["settled"], Value::Bool(true));
        assert_eq!(header["limit_usd"], 2.0, "micro-usd is served as dollars");
        assert_eq!(
            header["booked_usd"], 0.75,
            "booked is the charge watermark, not the calls' sum"
        );
        assert_eq!(
            header["attributed_to"]["id"],
            team.to_string(),
            "attribution is the DEEPEST charged unit"
        );
        assert_eq!(header["attributed_to"]["name"], "Platform");
        assert_eq!(
            header["attributed_to"]["level_label"], "Team",
            "the label is the tenant's own, not a hardcoded tier name"
        );
        let totals = &header["totals"];
        assert_eq!(
            totals["calls"], 2,
            "totals count the run's calls, not the tenant's"
        );
        assert_eq!(totals["failed"], 1);
        assert_eq!(totals["cost_usd"], 0.25, "the served call's price");
        assert_eq!(totals["input_tokens"], 20);
        assert_eq!(totals["output_tokens"], 10);

        let calls = run_calls(&pool, a, run).await.expect("read calls");
        let calls = calls.as_array().expect("calls array");
        assert_eq!(calls.len(), 2, "the chat call is not this run's");
        for c in calls {
            assert_eq!(c["run_id"], run.to_string());
            assert_eq!(
                c["budget_node_id"],
                team.to_string(),
                "the store attributed each call to the unit the header names"
            );
        }

        // A second run that was admitted but never scheduled and never called: the list must
        // still show it (admission is when a run starts spending), with no lifecycle to report
        // and zero spend, rather than making it wait to exist until the driver writes a row.
        let pending = Uuid::new_v4();
        sqlx::query(
            "insert into runs.run_charges \
               (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd, created_at) \
             values ($1, $2, $3, array[$4]::uuid[], 0, now() + interval '1 second')",
        )
        .bind(a)
        .bind(pending)
        .bind(Uuid::new_v4())
        .bind(org)
        .execute(&pool)
        .await
        .unwrap();

        let page = runs_page(&pool, a, 50, None, None, false)
            .await
            .expect("read runs");
        let rows = &page.rows;
        assert!(
            !page.has_more,
            "two runs fit a page of 50 — there is no older page to offer"
        );
        assert_eq!(rows.len(), 2, "every admitted run is listed, capped or not");
        assert_eq!(
            rows[0]["run_id"],
            pending.to_string(),
            "newest first — the unscheduled run was admitted last"
        );
        assert_eq!(
            rows[0]["status"],
            Value::Null,
            "no schedule row is a run with no lifecycle, not a failure"
        );
        assert_eq!(rows[0]["totals"]["calls"], 0);
        assert_eq!(
            rows[1], header,
            "the list row IS the detail header — one projection, two scopes"
        );

        // Another tenant sees neither the header nor the calls for this id, nor the run in a list.
        assert!(
            run_detail(&pool, b, run)
                .await
                .expect("read B header")
                .is_none(),
            "tenant B must not read tenant A's run"
        );
        assert!(
            runs_page(&pool, b, 50, None, None, false)
                .await
                .expect("read B runs")
                .rows
                .is_empty(),
            "tenant B must not list tenant A's runs"
        );
        assert!(
            run_calls(&pool, b, run)
                .await
                .expect("read B calls")
                .as_array()
                .expect("calls array")
                .is_empty(),
            "tenant B must not read tenant A's run calls"
        );

        // cleanup — `on delete cascade` clears the registry, schedule, charge and calls.
        for t in [a, b] {
            sqlx::query("delete from core.tenants where id = $1")
                .bind(t)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
}
