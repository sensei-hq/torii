-- database/ddl/procedure/staging/import_tenant_keys.ddl
set search_path to staging;

create or replace procedure import_tenant_keys()
language plpgsql
as
$$
begin
  insert into keyvault.tenant_keys(
     tenant_id, encrypted_dek, dek_version, modified_at, modified_by)
  select stg.tenant_id
       , decode(stg.encrypted_dek, 'hex') as encrypted_dek
       , coalesce(stg.dek_version, 1)
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.tenant_keys stg
   inner join core.tenants t
      on t.id = stg.tenant_id        -- skip rows when tenant not yet imported
   where not exists (
     select 1
       from keyvault.tenant_keys tk
      where tk.tenant_id   = stg.tenant_id
        and tk.modified_at > coalesce(stg.modified_at, now())
   )
  on conflict (tenant_id)
  do update
        set encrypted_dek = excluded.encrypted_dek
          , dek_version   = excluded.dek_version
          , modified_at   = excluded.modified_at
          , modified_by   = excluded.modified_by;
end;
$$;
