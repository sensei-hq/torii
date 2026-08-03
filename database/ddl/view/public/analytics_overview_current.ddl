-- database/ddl/view/public/analytics_overview_current.ddl
set search_path to public, core, extensions;

-- O2 §3.2: the W1 Overview stat-row snapshot, one row per tenant. spend/calls/
-- fallbacks "today", latency avg + p95, blended cost/call over the trailing 14d
-- (+ the prior 14d for the delta chip), and 14d savings. Materialized over the
-- usage rollup; refreshed CONCURRENTLY every ~60s (A4) — hence the unique index.
-- "today"/window are evaluated at refresh time (snapshot semantics). MV → no RLS →
-- never granted to authenticated (gateway reads it as service_role, tenant-scoped).
drop materialized view if exists analytics_overview_current cascade;
create materialized view analytics_overview_current as
  select
    u.tenant_id,
    coalesce(sum(u.cost_usd) filter (where u.day = current_date), 0)           as spend_today,
    ( select bn.cap_amount from public.budget_nodes bn
       where bn.tenant_id = u.tenant_id and bn.parent_id is null
       order by bn.cap_amount desc nulls last limit 1 )                        as spend_today_cap,
    coalesce(sum(u.calls) filter (where u.day = current_date), 0)              as calls_today,
    coalesce(sum(u.fallback_calls) filter (where u.day = current_date), 0)     as fallbacks_today,
    case when coalesce(sum(u.latency_ms_count) filter (where u.day = current_date), 0) > 0
         then round(sum(u.latency_ms_sum) filter (where u.day = current_date)::numeric
                    / sum(u.latency_ms_count) filter (where u.day = current_date), 1)
         else null end                                                        as latency_avg_ms,
    max(u.latency_ms_p95) filter (where u.day = current_date)                  as latency_p95_ms,
    case when coalesce(sum(u.calls) filter (where u.day > current_date - 14), 0) > 0
         then round(sum(u.cost_usd) filter (where u.day > current_date - 14)
                    / sum(u.calls) filter (where u.day > current_date - 14), 6)
         else 0 end                                                           as blended_cost_per_call_14d,
    case when coalesce(sum(u.calls) filter
             (where u.day > current_date - 28 and u.day <= current_date - 14), 0) > 0
         then round(sum(u.cost_usd) filter
                    (where u.day > current_date - 28 and u.day <= current_date - 14)
                  / sum(u.calls) filter
                    (where u.day > current_date - 28 and u.day <= current_date - 14), 6)
         else 0 end                                                           as blended_cost_per_call_14d_prev,
    coalesce(sum(u.savings_usd) filter (where u.day > current_date - 14), 0)   as savings_14d
  from public.analytics_usage_daily u
  group by u.tenant_id;

create unique index if not exists uq_analytics_overview_current
  on analytics_overview_current(tenant_id);
-- NB: no COMMENT ON MATERIALIZED VIEW — dbd 0.8.21's SQL parser rejects that target;
-- the header comment above is the documentation of record.
