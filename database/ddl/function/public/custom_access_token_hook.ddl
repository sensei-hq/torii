-- database/ddl/function/public/custom_access_token_hook.ddl
set search_path to public, core, extensions;

-- RW2: Supabase custom access-token hook. Injects the FROZEN claims contract
-- (F2 §4.1): tenant_id + role_ids[] + claims_version. The `role` enum and the
-- `groups[]` claim are DROPPED (group-ACL retired, RW9; capabilities are resolved
-- server-side from role_ids, keeping the token bounded). Runs as
-- supabase_auth_admin (SECURITY INVOKER), relying on policies/auth_admin.sql.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_claims   jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user     uuid  := (event ->> 'user_id')::uuid;
  v_tenant   uuid;
  v_version  bigint;
  v_roles    jsonb;
begin
  -- Active-tenant membership (single-valued tenant_id claim keeps RLS simple).
  select pt.tenant_id
    into v_tenant
    from core.profile_tenants pt
   where pt.profile_id = v_user
     and pt.active = true
     and pt.status = 'active';

  if v_tenant is not null then
    -- role_ids the user holds in the active tenant (capabilities resolved server-side).
    select coalesce(jsonb_agg(pr.role_id::text), '[]'::jsonb)
      into v_roles
      from core.profile_roles pr
     where pr.profile_id = v_user
       and pr.tenant_id  = v_tenant;

    -- Token-freshness counter (the downgrade-revocation gate).
    select coalesce(p.claims_version, 0)
      into v_version
      from core.profiles p
     where p.id = v_user;

    v_claims := jsonb_set(v_claims, '{tenant_id}',      to_jsonb(v_tenant::text), true);
    v_claims := jsonb_set(v_claims, '{role_ids}',       coalesce(v_roles, '[]'::jsonb), true);
    v_claims := jsonb_set(v_claims, '{claims_version}', to_jsonb(coalesce(v_version, 0)), true);
    event    := jsonb_set(event, '{claims}', v_claims, true);
  end if;

  return event;
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

comment on function public.custom_access_token_hook(jsonb) is
'RW2: Supabase custom access-token hook. Injects tenant_id + role_ids[] +
claims_version (F2 §4.1 frozen contract). No role enum, no groups[] claim.
Capabilities resolve server-side from role_ids (core.has_capability).';
