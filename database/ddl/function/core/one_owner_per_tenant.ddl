set search_path to core, extensions;

create or replace function core.one_owner_per_tenant() returns trigger
language plpgsql as $$
begin
  if NEW.role_id = (select id from core.roles where tenant_id is null and key='owner')
     and exists (
       select 1 from core.profile_roles pr
        where pr.tenant_id = NEW.tenant_id
          and pr.role_id = NEW.role_id
          and pr.profile_id <> NEW.profile_id
     ) then
    raise exception using errcode = 'unique_violation', message = 'tenant already has an owner';
  end if;
  return NEW;
end $$;

create or replace trigger profile_roles_one_owner
  before insert or update on core.profile_roles
  for each row execute function core.one_owner_per_tenant();
