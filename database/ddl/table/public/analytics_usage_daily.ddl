-- database/ddl/table/public/analytics_usage_daily.ddl
set search_path to public, core, extensions;

-- O2 §3.2: daily usage/cost/savings rollup over the authoritative inference_calls
-- ledger. A reconstructable cache (never a parallel source of truth) — dropping and
-- rebuilding it from inference_calls loses nothing (proven by the reconcile test).
-- Grain = (tenant, day, budget_node, served_model, provider, capability, plane).
-- A1 superseded the RW15 shell (grain/column change applied once on the empty cache). Idempotent
-- `if not exists` — a drop+create in versioned DDL would WIPE this rollup on any re-apply/reconcile.
create table if not exists analytics_usage_daily (
  tenant_id             uuid          not null references core.tenants(id) on delete cascade
, day                   date          not null
, budget_node_id        uuid          not null                    -- GH-5 attribution (no FK: cache)
, served_model          text          not null                    -- inference_calls.model
, provider              text          not null                    -- inference_calls.adapter
, capability            text          not null
, execution_location    core.execution_location not null            -- {local,cloud} enum
, calls                 bigint        not null default 0
, input_tokens          bigint        not null default 0
, output_tokens         bigint        not null default 0
, cost_usd              numeric(14,6) not null default 0          -- Σ actual (0 for local)
, cloud_equiv_usd       numeric(14,6) not null default 0          -- §8 baseline (A3); = cost_usd for cloud
, savings_usd           numeric(14,6) not null default 0          -- cloud_equiv_usd − cost_usd (≥0)
, fallback_calls        bigint        not null default 0
, latency_ms_sum        bigint        not null default 0          -- exact avg = sum/count
, latency_ms_count      bigint        not null default 0
, latency_ms_p95        integer                                   -- nullable; per-day p95 at reconcile (A4)
, local_only_calls      bigint        not null default 0          -- local calls with no cloud counterfactual
, savings_unpriced_calls bigint       not null default 0          -- local calls whose cloud step is unpriced
, primary key (tenant_id, day, budget_node_id, served_model, provider, capability, execution_location)
);

create index if not exists idx_analytics_usage_day
  on analytics_usage_daily(tenant_id, day);
create index if not exists idx_analytics_usage_node_day
  on analytics_usage_daily(tenant_id, budget_node_id, day);
create index if not exists idx_analytics_usage_model_day
  on analytics_usage_daily(tenant_id, served_model, day);

comment on table analytics_usage_daily is
'O2 §3.2: daily usage/cost/savings rollup over inference_calls, grouped by
budget_node/served_model/provider/capability/plane. Reconstructable cache,
reconciled against the immutable ledger. service_role-write only.';
