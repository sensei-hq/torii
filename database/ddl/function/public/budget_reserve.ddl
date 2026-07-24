set search_path to public, core, extensions;

-- C3 / RW7 (DECISIONS §2 W2): concurrency-safe hard budget reserve.
-- Locks the node's ancestor path FOR UPDATE, verifies every HARD ancestor has
-- headroom (cap - spent - reserved >= amount), bumps reserved_amount on the path,
-- and records a budget_hold. Serialized by the row locks → a hard cap cannot be
-- exceeded even under concurrent calls. Raises check_violation when over cap.
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

  -- Walk leaf → root, then lock the whole path FOR UPDATE (serializes racers).
  with recursive up as (
    select id, parent_id from public.budget_nodes
     where tenant_id = p_tenant and id = p_node
    union all
    select b.id, b.parent_id from public.budget_nodes b
      join up on b.id = up.parent_id
     where b.tenant_id = p_tenant
  )
  select array_agg(id) into v_path from up;

  if v_path is null then
    raise exception 'budget node % not found', p_node using errcode = 'no_data_found';
  end if;

  perform 1 from public.budget_nodes
   where tenant_id = p_tenant and id = any(v_path)
   for update;

  -- Any HARD ancestor without headroom blocks the whole reserve.
  select id into v_bad from public.budget_nodes
   where tenant_id = p_tenant and id = any(v_path)
     and enforcement = 'hard' and cap_amount is not null
     and (cap_amount - spent_amount - reserved_amount) < p_amount
   limit 1;
  if v_bad is not null then
    raise exception 'hard budget exceeded at node %', v_bad using errcode = 'check_violation';
  end if;

  update public.budget_nodes
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
'C3/RW7: concurrency-safe hard-cap reserve. Locks the ancestor path, checks
headroom at every hard node, records a budget_hold. service_role only.';
