-- database/ddl/table/metering/quality_daily.ddl
set search_path to metering, core, extensions;  -- §D Phase 6: was public.analytics_quality_daily

-- O2 §3.2: daily quality rollup over quality_signals (C6), blended with the usage
-- rollup so "cost down" is never shown without "quality held". Averages are
-- call-weighted; *_calls are counts for rates. Reconstructable cache; W5-clean
-- (counts/labels only — no prompt/response content). A1 superseded the RW15 shell. Idempotent
-- `if not exists` — a drop+create in versioned DDL would WIPE this rollup on any re-apply/reconcile.
create table if not exists quality_daily (
  tenant_id               uuid          not null references core.tenants(id) on delete cascade
, day                     date          not null
, org_unit_id          uuid          not null
, served_model            text          not null
, grounding_avg           numeric(6,3)
, judge_score_avg         numeric(6,3)
, retrieval_precision_avg numeric(6,3)
, retrieval_recall_avg    numeric(6,3)
, guardrail_hit_calls     bigint        not null default 0
, redaction_hit_calls     bigint        not null default 0
, rated_calls             bigint        not null default 0
, rating_avg              numeric(6,3)
, thumb_up                bigint        not null default 0
, thumb_down              bigint        not null default 0
, accept_calls            bigint        not null default 0
, edit_calls              bigint        not null default 0
, retry_calls             bigint        not null default 0
, primary key (tenant_id, day, org_unit_id, served_model)
);

create index if not exists idx_quality_daily_day
  on quality_daily(tenant_id, day);
create index if not exists idx_quality_daily_model_day
  on quality_daily(tenant_id, served_model, day);

comment on table quality_daily is
'O2 §3.2 (§D Phase 6, was analytics_quality_daily): daily quality-signal rollup over quality_signals
(C6), keyed to budget_node/served_model. Averages call-weighted; counts for rates. W5-clean,
reconstructable cache. service_role-write only.';
