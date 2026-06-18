set search_path to staging;

create or replace procedure import_modules()
language plpgsql
as
$$
begin
  insert into config.modules(
     slug, name, title, description, persona
   , sequence, is_active
   , modified_at, modified_by)
  select trim(stg.slug), stg.name, stg.title, stg.description, stg.persona
       , coalesce(stg.sequence, 0)
       , coalesce(stg.is_active, true)
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.modules stg
   where not exists (select 1
                       from config.modules m
                      where m.slug = trim(stg.slug)
                        and m.modified_at > stg.modified_at)
      on conflict(slug)
      do update
            set name        = excluded.name
              , title       = excluded.title
              , description = excluded.description
              , persona     = excluded.persona
              , sequence    = excluded.sequence
              , is_active   = excluded.is_active
              , modified_by = excluded.modified_by
              , modified_at = excluded.modified_at;
end;
$$;
