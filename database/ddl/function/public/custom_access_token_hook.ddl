-- database/ddl/function/public/custom_access_token_hook.ddl
set search_path to public, core, extensions;

-- Supabase custom access-token hook: injects tenant_id, role, and groups into
-- every issued JWT. Runs as supabase_auth_admin (SECURITY INVOKER), so it relies
-- on the read policies in policies/auth_admin.sql to see profile_tenants/profile_groups.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_claims    jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user      uuid  := (event ->> 'user_id')::uuid;
  v_tenant_id uuid;
  v_role      text;
  v_groups    jsonb;
begin
  select pt.tenant_id, pt.role
    into v_tenant_id, v_role
    from core.profile_tenants pt
   where pt.profile_id = v_user;

  if v_tenant_id is not null then
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id::text), true);
    v_claims := jsonb_set(v_claims, '{role}',      to_jsonb(v_role),            true);

    select coalesce(jsonb_agg(pg.group_id::text), '[]'::jsonb)
      into v_groups
      from public.profile_groups pg
     where pg.profile_id = v_user
       and pg.tenant_id  = v_tenant_id;

    v_claims := jsonb_set(v_claims, '{groups}', v_groups, true);
    event    := jsonb_set(event, '{claims}', v_claims, true);
  end if;

  return event;
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

comment on function public.custom_access_token_hook(jsonb) is
'Supabase custom access-token hook. Injects tenant_id, role, and groups claims
(from core.profile_tenants + public.profile_groups) into every issued JWT.
Enabled in supabase/config.toml; reads via policies/auth_admin.sql.';
