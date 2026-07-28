set search_path to staging;

-- Default-role grants → core.role_permissions (tenant_id NULL, referencing the shared default
-- roles). Reads staging.role_permissions + core.capabilities + core.roles, so dbd orders it after
-- import_roles + import_rbac_capabilities. owner = every capability; admin = all except
-- tenant.manage (both computed so a new capability auto-grants); editor/viewer/member/service =
-- the explicit staging rows. Idempotent on (role_id, capability).
create or replace procedure import_role_permissions()
language plpgsql
as
$$
begin
  -- null::uuid (not bare null → typed text) so the tenant_id column type matches across the union.
  insert into core.role_permissions (tenant_id, role_id, capability)
    -- owner: every capability
    select null::uuid, r.id, c.key
      from core.roles r
      join core.capabilities c on true
     where r.tenant_id is null and r.key = 'owner'
    union all
    -- admin: everything except tenant.manage (ownership-level)
    select null::uuid, r.id, c.key
      from core.roles r
      join core.capabilities c on c.key <> 'tenant.manage'
     where r.tenant_id is null and r.key = 'admin'
    union all
    -- editor/viewer/member/service: explicit staging rows
    select null::uuid, r.id, stg.capability
      from staging.role_permissions stg
      join core.roles r on r.tenant_id is null and r.key = trim(stg.role_key)
  on conflict (role_id, capability) do nothing;
end;
$$;
