set search_path to core, extensions;

-- §D Ledger Normalize LN-3c-2b: the NEAREST ancestor org_unit of p_unit at tier `p_level` (or p_unit
-- itself when its level = p_level; NULL if the path has no unit at that tier). Powers analytics
-- spend-by-tier after the *_node_id denorm columns were dropped: a call's leaf org_unit resolves to its
-- org/dept/team ancestor for the GROUP BY — the deliberate P12 reversal (a per-call tree walk, replacing
-- the O(1) denorm). `level` is a TIER label, NOT tree depth (a personal/service unit may hang off a
-- team), so walk parent_id up and pick the CLOSEST match by depth. STABLE, SECURITY DEFINER + pinned
-- search_path (analytics reads run as service_role; the walk must not depend on the caller's RLS).
create or replace function org_unit_ancestor_at_level(p_tenant uuid, p_unit uuid, p_level int)
returns uuid
language sql
stable
security definer
set search_path = core, extensions
as $$
  with recursive up as (
    select id, parent_id, level, 0 as depth
      from core.org_units where tenant_id = p_tenant and id = p_unit
    union all
    select ou.id, ou.parent_id, ou.level, up.depth + 1
      from core.org_units ou join up on ou.id = up.parent_id
     where ou.tenant_id = p_tenant
  )
  select id from up where level = p_level order by depth limit 1
$$;

revoke execute on function org_unit_ancestor_at_level(uuid, uuid, int) from public;
grant execute on function org_unit_ancestor_at_level(uuid, uuid, int) to service_role;

comment on function org_unit_ancestor_at_level is
'§D Ledger Normalize LN-3c-2b: nearest ancestor org_unit at tier `level` (self if it matches, NULL if
none). Backs analytics spend-by-tier (org/dept/team) after the *_node_id denorm was dropped. service_role.';
