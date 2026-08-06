-- database/ddl/view/governance/budget_tree_for_tenant.ddl
set search_path to governance, core, extensions;

-- §D §B ★ shield view (Phase 5): the flat budget-tree read contract backing GET /v1/budgets (nodes).
-- After the org/budget split the flat {parent_id, kind} contract is REASSEMBLED from the split schema:
-- structure (parent_id, name, level) from core.org_units, cap facet from governance.nodes (joined 1:1
-- via org_unit_id == id, DC-1), and `kind` derived from org_units.level via core.unit_kind — the fixed
-- machine map {org,dept,team,user,service} the frontend (org-tree.ts KIND_RANK/childKind) keys on (NOT
-- unit_levels.label, which is the separate human relabel). So org-tree.ts + the Activity cascade stay
-- BYTE-IDENTICAL while the table splits. Gateway-internal: read via the service_role pool,
-- tenant-filtered; NOT granted to authenticated (all-tenant rows, no security_invoker → a grant would
-- be a PostgREST cross-tenant leak; governance has no blanket table grant so this is deny-all by default).
create or replace view budget_tree_for_tenant as
select
  n.tenant_id
, n.id
, ou.parent_id
  -- §D: the fixed tier map INLINED (twin of core.unit_kind) — a view body may not call a function that
  -- dbd's apply-order can't sequence before it (dbd tracks table/view deps, NOT function refs → on a
  -- from-scratch `dbd apply` the view lands before core.unit_kind → "function does not exist"). The map is
  -- frozen (0=org…4=service); keep in sync with core.unit_kind (its runtime twin, used by gateway spend_sql).
, case ou.level
    when 0 then 'org' when 1 then 'dept' when 2 then 'team' when 3 then 'user' when 4 then 'service'
    else 'unit'
  end                                as kind
, ou.name
, n.cap_amount
, n.spent_amount
, n.reserved_amount
, n.enforcement
, n.period
, n.alert_threshold
, n.free_floor_enabled
from governance.nodes n
join core.org_units ou
  on  ou.tenant_id = n.tenant_id
  and ou.id        = n.org_unit_id;

comment on view budget_tree_for_tenant is
'Budget-tree read shield (§D §B, Phase 5): the flat BudgetNode contract for /v1/budgets. Reassembles
{id,parent_id,kind,name,cap/spent/reserved,enforcement,period,alert_threshold,free_floor_enabled} from
core.org_units (structure) × governance.nodes (cap, 1:1 via org_unit_id==id) with kind from
core.unit_kind(org_units.level). Gateway-internal; never grant to authenticated.';
