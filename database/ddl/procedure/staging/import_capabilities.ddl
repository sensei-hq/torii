set search_path to staging;

create or replace procedure import_capabilities()
language plpgsql
as
$$
begin
  insert into catalog.capability_types(
     name, description, category, parameters, modified_at, modified_by)
  select trim(stg.name), stg.description, stg.category, stg.parameters
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.capabilities stg
   where not exists (select 1
                       from catalog.capability_types c
                      where c.name       = trim(stg.name)
                        and c.modified_at > stg.modified_at)
      on conflict(name)
      do update
            set description = excluded.description
              , category    = excluded.category
              , parameters  = excluded.parameters
              , modified_by = excluded.modified_by
              , modified_at = excluded.modified_at;
end;
$$;
