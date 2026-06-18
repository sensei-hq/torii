-- database/ddl/function/core/assign_tenant_by_domain.ddl
set search_path to core, extensions;

create or replace function core.assign_tenant_by_domain()
returns trigger language plpgsql as $$
declare
  v_tenant_id uuid;
begin
  -- Only act if no tenant assignment already exists for this profile
  if exists (select 1 from core.profile_tenants where profile_id = NEW.id) then
    return NEW;
  end if;

  -- Match email domain against tenants.domain (active tenants only)
  select id into v_tenant_id
  from core.tenants
  where domain  = split_part(NEW.email, '@', 2)
    and status  = 'active'
  limit 1;

  if v_tenant_id is not null then
    insert into core.profile_tenants (profile_id, tenant_id, assigned_by)
    values (NEW.id, v_tenant_id, 'domain_trigger');
  end if;

  return NEW;
end;
$$;

create or replace trigger assign_tenant_by_domain_trigger
  after insert on auth.users
  for each row execute function core.assign_tenant_by_domain();

comment on function core.assign_tenant_by_domain() is
'Auto-assigns new auth.users to a tenant by matching the email domain.
- Fires after insert on auth.users
- Skips if the profile already has a tenant assignment
- Only matches active tenants (suspended/trial tenants do not auto-claim users)
- Inserts into core.profile_tenants with assigned_by = ''domain_trigger''';
