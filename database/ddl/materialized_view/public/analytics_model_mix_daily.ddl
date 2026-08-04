-- database/ddl/materialized_view/public/analytics_model_mix_daily.ddl
set search_path to public, core, extensions;

-- O2 §3.2: "Most-used models" panel. Per (tenant, day, model, provider, plane):
-- calls, share of that tenant/day's calls, cost, savings. Materialized over the
-- usage rollup for cheap dashboard reads; refreshed CONCURRENTLY (A4), which
-- requires the unique index below. MVs cannot carry RLS → never granted to
-- authenticated (read through the gateway as service_role; see policies/analytics.sql).
-- `if not exists` so re-apply is a NO-OP that preserves the matview + its rollup data. MVs have no
-- CREATE OR REPLACE; to change THIS definition, DROP it manually then re-apply (dbd reconcile only
-- warns on matview drift, never auto-drops — see the dbd skill).
create materialized view if not exists analytics_model_mix_daily as
  select
    tenant_id, day, served_model, provider, execution_location,
    sum(calls)                                                                as calls,
    round(100.0 * sum(calls)
          / nullif(sum(sum(calls)) over (partition by tenant_id, day), 0), 2) as share_pct,
    sum(cost_usd)                                                             as cost_usd,
    sum(savings_usd)                                                          as savings_usd
  from public.analytics_usage_daily
  group by tenant_id, day, served_model, provider, execution_location;

create unique index if not exists uq_analytics_model_mix
  on analytics_model_mix_daily(tenant_id, day, served_model, provider, execution_location);
-- NB: no COMMENT ON MATERIALIZED VIEW — dbd 0.8.21's SQL parser rejects that target;
-- the header comment above is the documentation of record.
