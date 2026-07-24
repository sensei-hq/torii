-- database/ddl/function/core/assign_tenant_by_domain.ddl
set search_path to core, extensions;

-- RW2: on new auth.users, (1) ALWAYS create the core.profiles identity anchor
-- (so the profile_roles/profile_tenants FKs + claims_version gate work), then
-- (2) if the email domain matches an active tenant, assign membership + the
-- default 'member' role. SECURITY DEFINER so it can write as the owner regardless
-- of the GoTrue role's grants (mirrors Supabase's own hooks). Must never raise —
-- a failure here would roll back the auth.users insert (the signup-500).
create or replace function core.assign_tenant_by_domain()
returns trigger
language plpgsql
security definer
set search_path = core, extensions
as $$
declare
  v_tenant_id uuid;
  v_member    uuid;
begin
  -- (1) identity anchor for every user.
  insert into core.profiles (id) values (NEW.id) on conflict (id) do nothing;

  -- skip if already assigned to a tenant.
  if exists (select 1 from core.profile_tenants where profile_id = NEW.id) then
    return NEW;
  end if;

  -- (2) match the email domain against an active tenant.
  select id into v_tenant_id
    from core.tenants
   where domain = split_part(NEW.email, '@', 2) and status = 'active'
   limit 1;

  if v_tenant_id is not null then
    insert into core.profile_tenants (profile_id, tenant_id, assigned_by)
      values (NEW.id, v_tenant_id, 'domain_trigger')
      on conflict (profile_id) do nothing;

    select id into v_member from core.roles
     where tenant_id = v_tenant_id and key = 'member';
    if v_member is not null then
      insert into core.profile_roles (tenant_id, profile_id, role_id, assigned_by)
        values (v_tenant_id, NEW.id, v_member, 'domain_trigger')
        on conflict do nothing;
    end if;
  end if;

  return NEW;
end;
$$;

create or replace trigger assign_tenant_by_domain_trigger
  after insert on auth.users
  for each row execute function core.assign_tenant_by_domain();

comment on function core.assign_tenant_by_domain() is
'RW2: after insert on auth.users — always creates the core.profiles anchor, then
auto-assigns tenant membership + the default member role by email domain (active
tenants only). SECURITY DEFINER; never raises (would roll back signup).';
