-- database/ddl/procedure/staging/import_router_credentials.ddl
set search_path to staging;

create or replace procedure import_router_credentials()
language plpgsql
as
$$
begin
  insert into public.router_credentials(
     tenant_id, router_id, encrypted_api_key
   , key_label, is_active, modified_at, modified_by)
  select stg.tenant_id
       , rtr.id as router_id
       , decode(stg.encrypted_api_key, 'hex') as encrypted_api_key
       , stg.key_label
       , coalesce(stg.is_active, true)
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.router_credentials stg
   inner join catalog.routers rtr
      on rtr.name = trim(stg.router_name)
   inner join core.tenants t
      on t.id = stg.tenant_id        -- skip rows when tenant not yet imported
   -- Idempotent via this guard (no ON CONFLICT): the active-unique index is now partial
   -- ((tenant_id, router_id, credential_type) WHERE is_active), so a bare
   -- `ON CONFLICT (tenant_id, router_id)` matches no constraint. Seed only inserts the api_key
   -- credential (credential_type defaults to 'api_key'); an existing api_key row is left as-is.
   where not exists (
     select 1
       from public.router_credentials rk
      where rk.tenant_id       = stg.tenant_id
        and rk.router_id       = rtr.id
        and rk.credential_type = 'api_key'
   );
end;
$$;
