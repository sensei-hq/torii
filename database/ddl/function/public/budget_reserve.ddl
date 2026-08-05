set search_path to public, core, governance, extensions;

-- C3 / RW7 (DECISIONS §2 W2): concurrency-safe hard budget reserve.
-- §D Phase 5: the ancestor path now comes from the ORG TREE (core.org_units.parent_id); the cap rows
-- are governance.nodes joined on org_unit_id. p_node is the caller's node id == its org_unit_id (DC-1),
-- so the walk starts at that unit. Locks the cap rows on the ancestor path FOR UPDATE, verifies every
-- HARD ancestor has headroom (cap - spent - reserved >= amount), bumps reserved_amount on the path, and
-- records a budget_hold. Serialized by the row locks → a hard cap cannot be exceeded even under
-- concurrent calls. Raises check_violation when over cap.
create or replace function public.budget_reserve(
  p_tenant uuid,
  p_node   uuid,
  p_amount numeric,
  p_idem   text default null
) returns uuid
language plpgsql
as $$
declare
  v_path uuid[];
  v_bad  uuid;
  v_hold uuid;
begin
  -- Idempotent retry: return the existing active hold for this key.
  if p_idem is not null then
    select id into v_hold from public.budget_holds
     where tenant_id = p_tenant and idempotency_key = p_idem and status = 'active';
    if found then return v_hold; end if;
  end if;

  -- Walk the org tree leaf → root over core.org_units.parent_id (p_node == the leaf unit's id, DC-1),
  -- then map each ancestor unit to its cap row → v_path is the governance.nodes ids on the path.
  with recursive up as (
    select ou.id, ou.parent_id from core.org_units ou
     where ou.tenant_id = p_tenant and ou.id = p_node
    union all
    select ou.id, ou.parent_id from core.org_units ou
      join up on ou.id = up.parent_id
     where ou.tenant_id = p_tenant
  )
  select array_agg(n.id) into v_path
    from up
    join governance.nodes n
      on n.tenant_id = p_tenant and n.org_unit_id = up.id;

  if v_path is null then
    raise exception 'budget node % not found', p_node using errcode = 'no_data_found';
  end if;

  -- Lock the whole path FOR UPDATE (serializes racers).
  perform 1 from governance.nodes
   where tenant_id = p_tenant and id = any(v_path)
   for update;

  -- Any HARD ancestor without headroom blocks the whole reserve.
  select id into v_bad from governance.nodes
   where tenant_id = p_tenant and id = any(v_path)
     and enforcement = 'hard' and cap_amount is not null
     and (cap_amount - spent_amount - reserved_amount) < p_amount
   limit 1;
  if v_bad is not null then
    raise exception 'hard budget exceeded at node %', v_bad using errcode = 'check_violation';
  end if;

  update governance.nodes
     set reserved_amount = reserved_amount + p_amount
   where tenant_id = p_tenant and id = any(v_path);

  insert into public.budget_holds
    (tenant_id, budget_node_id, path_node_ids, amount, idempotency_key, expires_at)
  values
    (p_tenant, p_node, v_path, p_amount, p_idem, now() + interval '5 minutes')
  returning id into v_hold;

  return v_hold;
end;
$$;

revoke execute on function public.budget_reserve(uuid, uuid, numeric, text) from public;
grant execute on function public.budget_reserve(uuid, uuid, numeric, text) to service_role;

comment on function public.budget_reserve is
'C3/RW7: concurrency-safe hard-cap reserve (§D Phase 5: ancestor path from core.org_units.parent_id,
caps from governance.nodes via org_unit_id). Locks the ancestor path, checks headroom at every hard
node, records a budget_hold. service_role only.';
