-- database/ddl/function/core/unit_kind.ddl
set search_path to core, extensions;

-- §D Phase 5 (org/budget split): the FIXED org-tree tier ordinal → machine `kind` mapping. Single
-- source of truth for the legacy `kind` string ({org,dept,team,user,service}) that the budget-tree
-- read contract + frontend (org-tree.ts KIND_RANK/childKind) + the ledger's {org,dept,team,user}_node_id
-- attribution all key on. Derived from core.org_units.level, NOT from unit_levels.label (labels are the
-- separate human relabel). Immutable + pure so it inlines in the budget_tree_for_tenant shield and any
-- level→kind projection.
create or replace function unit_kind(p_level int) returns text
language sql immutable
as $$
  select case p_level
           when 0 then 'org'
           when 1 then 'dept'
           when 2 then 'team'
           when 3 then 'user'
           when 4 then 'service'
           else 'unit'
         end
$$;

comment on function unit_kind is
'§D Phase 5: org_units.level → machine kind {org,dept,team,user,service}. The fixed tier map
(0=org…4=service) backing the budget-tree `kind` contract; unit_levels.label is the human relabel.';
