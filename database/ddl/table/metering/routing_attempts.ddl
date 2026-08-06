-- database/ddl/table/metering/routing_attempts.ddl
set search_path to metering, core, extensions;

-- §D Ledger Normalize (§112): the per-attempt routing trace, NORMALIZED out of execution_traces.trace
-- (jsonb attempts[]) into rows — for the Compare/Requests "why did this model answer" UI. Populated by
-- the AFTER-INSERT trigger on execution_traces (metering.routing_attempts_from_trace). One row per
-- attempt in the winning chain. adapter/model are text now (mirror the trace); they FK-normalize to
-- catalog router_id/model_id in LN-3 alongside inference_calls. service_role-write (trigger), tenant SELECT.
create table if not exists routing_attempts (
  tenant_id          uuid     not null references core.tenants(id) on delete cascade
, id                 uuid     not null default gen_random_uuid()
, inference_call_id  uuid     not null
, attempt_no         smallint not null                 -- Attempt.sequence
, adapter            text     not null                 -- Attempt.adapter (→ router_id FK in LN-3)
, model              text     not null                 -- Attempt.model   (→ model_id FK in LN-3)
, api_model_id       text                              -- Attempt.api_model_id
, plane              core.execution_location           -- derived from adapter (local/cloud); nullable
, latency_ms         bigint                            -- Attempt.duration_ms
, outcome            text     not null                 -- Attempt.status (success/failed/skipped/…)
, cost_usd           numeric(14,6)                     -- Attempt.cost
, error              text                              -- Attempt.error (the fallback trigger)
, fallback_triggered boolean  not null default false   -- Attempt.fallback_triggered
, created_at         timestamptz not null default now()
, primary key (tenant_id, id)
, foreign key (tenant_id, inference_call_id)
    references metering.inference_calls(tenant_id, id) on delete cascade
);

create index if not exists idx_routing_attempts_call
  on routing_attempts(tenant_id, inference_call_id, attempt_no);

comment on table routing_attempts is
'§D Ledger Normalize (§112): per-attempt routing trace normalized from execution_traces.trace (jsonb
attempts[]) by the execution_traces AFTER-INSERT trigger. Backs the Compare/Requests fallback view.
adapter/model text now → catalog router_id/model_id FK in LN-3. service_role-write (trigger), tenant SELECT.';
