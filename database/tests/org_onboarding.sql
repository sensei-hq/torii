-- M1 · org-onboarding grants + ownership invariants. Run after apply+import+policies.
\set ON_ERROR_STOP on
\echo '== M1 org-onboarding: role grants + owner singularity =='
do $$
declare
  owner_id uuid := (select id from core.roles where tenant_id is null and key = 'owner');
  admin_id uuid := (select id from core.roles where tenant_id is null and key = 'admin');
  n_caps int := (select count(*) from core.capabilities);
  n_owner int := (select count(*) from core.role_permissions where role_id = owner_id and tenant_id is null);
  n_admin int := (select count(*) from core.role_permissions where role_id = admin_id and tenant_id is null);
begin
  if n_owner <> n_caps then
    raise exception 'FAIL owner grants: owner has % of % capabilities', n_owner, n_caps;
  end if;
  if n_admin <> n_caps - 3 then
    raise exception 'FAIL admin grants: admin has % (expected %)', n_admin, n_caps - 3;
  end if;
  if exists (
    select 1 from core.role_permissions
     where role_id = admin_id and tenant_id is null
       and capability in ('tenant.manage', 'role.manage', 'apikey.manage')
  ) then
    raise exception 'FAIL admin grants: admin still holds a reserved capability';
  end if;
end $$;

begin;
  insert into core.profiles (id) values
    ('aaaaaaaa-0000-0000-0000-000000000001'),
    ('aaaaaaaa-0000-0000-0000-000000000002') on conflict do nothing;
  insert into core.profile_tenants (profile_id, tenant_id, assigned_by) values
    ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','t')
    on conflict do nothing;
  do $$
  declare owner_id uuid := (select id from core.roles where tenant_id is null and key='owner');
  begin
    insert into core.profile_roles(tenant_id, profile_id, role_id, assigned_by)
      values ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000001',owner_id,'t');
    begin
      insert into core.profile_roles(tenant_id, profile_id, role_id, assigned_by)
        values ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000002',owner_id,'t');
      raise exception 'FAIL singularity: a tenant accepted a SECOND owner';
    exception when unique_violation then null; end;
  end $$;
rollback;
\echo 'OK M1 org-onboarding'
