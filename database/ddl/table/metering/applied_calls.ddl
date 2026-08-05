-- database/ddl/table/metering/applied_calls.ddl
set search_path to metering, core, extensions;  -- §D Phase 6: was public.analytics_applied_calls

-- O2 (§4.3 / §9 AC-2): idempotency marker for the incremental usage fan-out. One row
-- per inference_call that has been counted into metering.usage_daily, so a replayed
-- apply (retriggered insert, manual reconcile call) cannot double-count the usage
-- increment. Internal cache infrastructure — service_role only, no client access.
create table if not exists applied_calls (
  tenant_id         uuid        not null references core.tenants(id) on delete cascade
, inference_call_id uuid        not null
, applied_at        timestamptz not null default now()
, primary key (tenant_id, inference_call_id)
);

comment on table applied_calls is
'O2 (§D Phase 6, was analytics_applied_calls): usage-fan-out idempotency marker (tenant,
inference_call_id). Guards metering.usage_daily against double-counting a replayed apply.
service_role only.';
