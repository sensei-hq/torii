-- database/ddl/procedure/staging/import_router_keys.ddl
set search_path to staging;

create or replace procedure import_router_keys()
language plpgsql
as
$$
begin
  insert into public.router_keys(
     tenant_id, router_id, encrypted_api_key
   , key_label, is_active, modified_at, modified_by)
  select stg.tenant_id
       , rtr.id as router_id
       , decode(stg.encrypted_api_key, 'hex') as encrypted_api_key
       , stg.key_label
       , coalesce(stg.is_active, true)
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.router_keys stg
   inner join config.routers rtr
      on rtr.name = trim(stg.router_name)
   inner join core.tenants t
      on t.id = stg.tenant_id        -- skip rows when tenant not yet imported
   where not exists (
     select 1
       from public.router_keys rk
      where rk.tenant_id   = stg.tenant_id
        and rk.router_id   = rtr.id
   )
  on conflict (tenant_id, router_id)
  do update
        set encrypted_api_key = excluded.encrypted_api_key
          , key_label         = excluded.key_label
          , is_active         = excluded.is_active
          , modified_at       = excluded.modified_at
          , modified_by       = excluded.modified_by;
end;
$$;
