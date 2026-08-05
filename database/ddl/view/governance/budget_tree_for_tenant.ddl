-- database/ddl/view/governance/budget_tree_for_tenant.ddl
set search_path to governance, public, core, extensions;

-- §D §B ★ shield view (Phase 5): the flat budget-tree read contract backing GET /v1/budgets (nodes).
-- Shipped BEFORE the budget_nodes→governance.nodes org/budget split so the frontend org-tree
-- (org-tree.ts buildTree/childKind keys on the machine `kind` in {org,dept,team,user,service}) and
-- the Activity cascade stay BYTE-IDENTICAL while the table splits into core.org_units (structure) +
-- governance.nodes (caps). S1 = a passthrough over the still-conflated public.budget_nodes; S3 swaps
-- the body to `governance.nodes × core.org_units × core.unit_levels` deriving `kind` from
-- org_units.level (core.unit_kind) — the view NAME + column contract never change across the move.
-- Gateway-internal: read via the service_role pool, tenant-filtered; NOT granted to authenticated
-- (all-tenant rows, no security_invoker → a grant would be a PostgREST cross-tenant leak).
create or replace view budget_tree_for_tenant as
select
  tenant_id
, id
, parent_id
, kind
, name
, cap_amount
, spent_amount
, reserved_amount
, enforcement
, period
, alert_threshold
, free_floor_enabled
from public.budget_nodes;

comment on view budget_tree_for_tenant is
'Budget-tree read shield (§D §B, Phase 5): the flat BudgetNode contract for /v1/budgets. S1
passes through public.budget_nodes; after the org/budget split the body reads
governance.nodes × core.org_units × core.unit_levels (kind derived from org_units.level) with the
same columns. Gateway-internal; never grant to authenticated.';
