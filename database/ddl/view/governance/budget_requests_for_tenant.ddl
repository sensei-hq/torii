-- database/ddl/view/governance/budget_requests_for_tenant.ddl
set search_path to governance, public, core, extensions;

-- §D §B shield view (Phase 5): the member cap-increase request read contract backing GET /v1/budgets
-- (requests) + the Activity feed. Shipped BEFORE the org/budget split so BudgetRequest stays
-- byte-identical while budget_requests.node_id repoints to governance.nodes and requested_cap widens
-- to numeric(14,6) behind the view. S1 = passthrough over public.budget_requests (requested_by is the
-- raw requester uuid, matching the current /v1/budgets read; a profiles-join display name is a later
-- enrichment). Gateway-internal: NOT granted to authenticated.
create or replace view budget_requests_for_tenant as
select
  tenant_id
, id
, node_id
, requested_by
, requested_cap
, reason
, status
, created_at
from public.budget_requests;

comment on view budget_requests_for_tenant is
'Budget-request read shield (§D §B, Phase 5): the BudgetRequest contract for /v1/budgets (requests).
S1 passes through public.budget_requests; the split repoints node_id → governance.nodes and widens
requested_cap behind the view. Gateway-internal; never grant to authenticated.';
