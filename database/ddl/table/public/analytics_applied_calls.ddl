-- database/ddl/table/public/analytics_applied_calls.ddl
set search_path to public, core, extensions;

-- O2 (§4.3 / §9 AC-2): idempotency marker for the incremental usage fan-out. One row
-- per inference_call that has been counted into analytics_usage_daily, so a replayed
-- apply (retriggered insert, manual reconcile call) cannot double-count the usage
-- increment. Internal cache infrastructure — service_role only, no client access.
create table if not exists analytics_applied_calls (
  tenant_id         uuid        not null references core.tenants(id) on delete cascade
, inference_call_id uuid        not null
, applied_at        timestamptz not null default now()
, primary key (tenant_id, inference_call_id)
);

comment on table analytics_applied_calls is
'O2: usage-fan-out idempotency marker (tenant, inference_call_id). Guards
analytics_usage_daily against double-counting a replayed apply. service_role only.';
