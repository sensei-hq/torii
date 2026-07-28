set search_path to staging;

-- Shared default system roles → core.roles with tenant_id NULL (one static row per key, shared
-- across all tenants via core.effective_roles). Reads staging.roles, so dbd auto-runs it.
create or replace procedure import_roles()
language plpgsql
as
$$
begin
  insert into core.roles (tenant_id, key, name, is_system, created_by)
  select null, trim(stg.key), stg.name, coalesce(stg.is_system, true), 'seed'
    from staging.roles stg
  on conflict (tenant_id, key) do update
        set name      = excluded.name
          , is_system = excluded.is_system;
end;
$$;
