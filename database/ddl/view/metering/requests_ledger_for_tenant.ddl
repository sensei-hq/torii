-- database/ddl/view/metering/requests_ledger_for_tenant.ddl
set search_path to metering, core, extensions;

-- §D §B ★ shield view (Ledger Normalize): the /v1/requests read contract. Shipped BEFORE the
-- inference_calls FK-normalize so RequestRow stays byte-identical while adapter/model become catalog
-- FKs, cost_usd→cost_actual, and *_node_id→org_unit_id. LN-1 is a passthrough over the current
-- metering.inference_calls; LN-3 swaps the body to resolve the catalog FKs back to adapter/model names
-- (and cost_actual→cost_usd, org_unit_id→budget_node_id) with the SAME columns. Gateway-internal: read
-- via the service_role pool, tenant-filtered; NOT granted to authenticated (no security_invoker → a
-- grant would bypass inference_calls RLS and return every tenant's rows; metering has no blanket table
-- grant → deny-all by default).
create or replace view requests_ledger_for_tenant as
select
  tenant_id
, id
, chain_id
, adapter
, model
, org_unit_id as budget_node_id   -- §D LN-3c-2b: budget_node_id col dropped; RequestRow keeps the name (= org_unit_id)
, execution_location
, input_tokens
, output_tokens
, cost_actual as cost_usd          -- §D LN-4b: ledger col renamed cost_usd→cost_actual; contract keeps cost_usd
, duration_ms
, status
, fallback_sequence
, recorded_at
, cost_estimated                   -- §D LN-4: gateway pre-call estimate (USD), snapshotted alongside actual cost_usd. Appended at END so CREATE OR REPLACE stays idempotent (can't reorder existing view cols).
from metering.inference_calls;

comment on view requests_ledger_for_tenant is
'Requests-ledger read shield (§D §B, Ledger Normalize): the RequestRow contract for /v1/requests. LN-1
passes through metering.inference_calls; the FK-normalize (LN-3) swaps the body to resolve
model_id/router_id→adapter/model + cost_actual→cost_usd + org_unit_id→budget_node_id with the same
columns. Gateway-internal; never grant to authenticated.';
