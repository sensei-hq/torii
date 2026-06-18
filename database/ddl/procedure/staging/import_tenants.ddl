-- database/ddl/procedure/staging/import_tenants.ddl
set search_path to staging;

create or replace procedure import_tenants()
language plpgsql
as
$$
begin
  insert into core.tenants(
     id, name, slug, domain, is_platform, status
   , created_at, modified_at, modified_by)
  select stg.id
       , stg.name
       , stg.slug
       , stg.domain
       , coalesce(stg.is_platform, false)
       , coalesce(stg.status, 'trial')
       , coalesce(stg.created_at, now())
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.tenants stg
   where not exists (
     select 1
       from core.tenants t
      where t.id           = stg.id
        and t.modified_at  > coalesce(stg.modified_at, now())
   )
  on conflict (id)
  do update
        set name         = excluded.name
          , slug         = excluded.slug
          , domain       = excluded.domain
          , is_platform  = excluded.is_platform
          , status       = excluded.status
          , modified_at  = excluded.modified_at
          , modified_by  = excluded.modified_by;
end;
$$;
