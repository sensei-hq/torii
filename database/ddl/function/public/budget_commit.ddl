set search_path to public, core, extensions;

-- C3/RW7: commit a hold — release its reserve on the path and add the ACTUAL
-- metered cost to spent_amount. Idempotent (only acts on an active hold).
create or replace function public.budget_commit(
  p_tenant uuid,
  p_hold   uuid,
  p_actual numeric
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
     set reserved_amount = greatest(0, reserved_amount - v_amount),
         spent_amount    = spent_amount + p_actual
   where tenant_id = p_tenant and id = any(v_path);

  update public.budget_holds set status = 'committed'
   where tenant_id = p_tenant and id = p_hold;
end;
$$;

revoke execute on function public.budget_commit(uuid, uuid, numeric) from public;
grant execute on function public.budget_commit(uuid, uuid, numeric) to service_role;

comment on function public.budget_commit is
'C3/RW7: release a hold and record actual spend on the node path. service_role only.';
