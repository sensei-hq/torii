set search_path to public, core, extensions;

-- C2 (RW14): resolve the effective fallback chain for a capability, given the
-- caller's space + roles. Most-specific binding wins: (space AND role) >
-- (space only) > (role only) > tenant default (both null). Returns NULL when no
-- binding matches (caller falls back to a capability default in config).
create or replace function public.resolve_chain(
  p_tenant     uuid,
  p_capability text,
  p_space      uuid,
  p_role_ids   uuid[]
) returns uuid
language sql
stable
as $$
  select chain_id
    from catalog.chain_bindings
   where tenant_id  = p_tenant
     and capability = p_capability
     and (space_id is null or space_id = p_space)
     and (role_id  is null or role_id  = any(p_role_ids))
   order by ((space_id is not null)::int + (role_id is not null)::int) desc,  -- specificity
            (space_id is not null)::int desc                                  -- space beats role
   limit 1;
$$;

revoke execute on function public.resolve_chain(uuid, text, uuid, uuid[]) from public;
grant execute on function public.resolve_chain(uuid, text, uuid, uuid[]) to authenticated;
grant execute on function public.resolve_chain(uuid, text, uuid, uuid[]) to service_role;

comment on function public.resolve_chain is
'C2/RW14: resolve the effective chain for (capability, space, roles) — most
specific binding wins (space+role > space > role > default). NULL ⇒ config default.';
