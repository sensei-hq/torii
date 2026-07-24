set search_path to public, core, extensions;

-- C3/RW7: release a hold without spend (call failed / cancelled).
create or replace function public.budget_release(
  p_tenant uuid,
  p_hold   uuid
) returns void
language plpgsql
as $$
declare
  v_path   uuid[];
  v_amount numeric;
begin
  select path_node_ids, amount into v_path, v_amount
    from public.budget_holds
   where tenant_id = p_tenant and id = p_hold and status = 'active'
   for update;
  if not found then return; end if;

  update public.budget_nodes
     set reserved_amount = greatest(0, reserved_amount - v_amount)
   where tenant_id = p_tenant and id = any(v_path);

  update public.budget_holds set status = 'released'
   where tenant_id = p_tenant and id = p_hold;
end;
$$;

revoke execute on function public.budget_release(uuid, uuid) from public;
grant execute on function public.budget_release(uuid, uuid) to service_role;

comment on function public.budget_release is
'C3/RW7: release a hold with no spend (failed/cancelled call). service_role only.';
