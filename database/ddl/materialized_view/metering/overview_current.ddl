-- database/ddl/materialized_view/metering/overview_current.ddl
set search_path to metering, public, core, governance, extensions;  -- §D Phase 6: was public.analytics_overview_current

-- O2 §3.2: the W1 Overview stat-row snapshot, one row per tenant. spend/calls/
-- fallbacks "today", latency avg + p95, blended cost/call over the trailing 14d
-- (+ the prior 14d for the delta chip), and 14d savings. Materialized over the
-- usage rollup; refreshed CONCURRENTLY every ~60s (A4) — hence the unique index.
-- "today"/window are evaluated at refresh time (snapshot semantics). MV → no RLS →
-- never granted to authenticated (gateway reads it as service_role, tenant-scoped).
-- `if not exists` so re-apply preserves the matview + data (MVs have no CREATE OR REPLACE; to change
-- THIS definition, drop it manually then re-apply).
create materialized view if not exists overview_current as
  select
    u.tenant_id,
    coalesce(sum(u.cost_usd) filter (where u.day = current_date), 0)           as spend_today,
    -- §D Phase 5: the tenant-root cap now lives on governance.nodes, joined to the org_units root
    -- (parent_id is null) via org_unit_id (== id, DC-1). Was public.budget_nodes(parent_id is null).
    ( select n.cap_amount from governance.nodes n
       join core.org_units ou on ou.tenant_id = n.tenant_id and ou.id = n.org_unit_id
       where n.tenant_id = u.tenant_id and ou.parent_id is null
       order by n.cap_amount desc nulls last limit 1 )                        as spend_today_cap,
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
  from metering.usage_daily u
  group by u.tenant_id;

create unique index if not exists uq_overview_current
  on overview_current(tenant_id);
-- NB: no COMMENT ON MATERIALIZED VIEW — dbd 0.8.21's SQL parser rejects that target;
-- the header comment above is the documentation of record.
