set search_path to staging;

create or replace procedure import_providers()
language plpgsql
as
$$
begin
  insert into catalog.providers(
     name, description, website_url, founded_year, headquarters
   , specialization, is_active, is_open_source, sequence
   , modified_at, modified_by)
  select trim(stg.name), stg.description, stg.website_url, stg.founded_year
       , stg.headquarters, stg.specialization
       , coalesce(stg.is_active, true)
       , coalesce(stg.is_open_source, false)
       , coalesce(stg.sequence, 0)
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.providers stg
   where not exists (select 1
                       from catalog.providers p
                      where p.name = trim(stg.name)
                        and p.modified_at > stg.modified_at)
      on conflict(name)
      do update
            set description    = excluded.description
              , website_url    = excluded.website_url
              , founded_year   = excluded.founded_year
              , headquarters   = excluded.headquarters
              , specialization = excluded.specialization
              , is_active      = excluded.is_active
              , is_open_source = excluded.is_open_source
              , sequence       = excluded.sequence
              , modified_by    = excluded.modified_by
              , modified_at    = excluded.modified_at;
end;
$$;
