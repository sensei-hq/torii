-- database/ddl/procedure/staging/import_fallback_chains.ddl
set search_path to staging;

create or replace procedure import_fallback_chains()
language plpgsql
as
$$
begin
  insert into catalog.chains(
     tenant_id, name, capability_id
   , max_fallback_attempts, circuit_breaker_threshold, circuit_breaker_window_minutes
   , is_active, priority, description, modified_at, modified_by)
  select (select id from core.tenants where is_platform = true limit 1) as tenant_id
       , stg.name
       , cap.id as capability_id
       , stg.max_fallback_attempts
       , stg.circuit_breaker_threshold
       , stg.circuit_breaker_window_minutes
       , stg.is_active
       , stg.priority
       , stg.description
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.fallback_chains stg
   inner join catalog.capability_types cap
      on cap.name = trim(stg.capability_name)
   where not exists (
     select 1
       from catalog.chains fc
      where fc.tenant_id   = (select id from core.tenants where is_platform = true limit 1)
        and fc.name        = trim(stg.name)
        and fc.modified_at > coalesce(stg.modified_at, now())
   )
  on conflict (tenant_id, name)
  do update
        set capability_id                = excluded.capability_id
          , max_fallback_attempts        = excluded.max_fallback_attempts
          , circuit_breaker_threshold    = excluded.circuit_breaker_threshold
          , circuit_breaker_window_minutes = excluded.circuit_breaker_window_minutes
          , is_active                    = excluded.is_active
          , priority                     = excluded.priority
          , description                  = excluded.description
          , modified_by                  = excluded.modified_by
          , modified_at                  = excluded.modified_at;
end;
$$;
