set search_path to staging;

-- RBAC capability catalog → core.permissions (F2 §4.3). Reads staging.rbac_capabilities, so dbd
-- auto-runs it during import. Idempotent upsert on the capability key.
create or replace procedure import_rbac_capabilities()
language plpgsql
as
$$
begin
  insert into core.permissions (key, domain, description)
  select trim(stg.key), stg.domain, stg.description
    from staging.rbac_capabilities stg
  on conflict (key) do update
        set domain      = excluded.domain
          , description = excluded.description;
end;
$$;
