set search_path to staging;

create or replace procedure import_features()
language plpgsql
as
$$
begin
  insert into config.features(
     module_id, slug, title, description, purpose, benefit, example
   , enabled, mandatory, sequence
   , modified_at, modified_by)
  select mod.id as module_id
       , trim(stg.slug)
       , stg.title
       , stg.description
       , stg.purpose
       , stg.benefit
       , stg.example
       , coalesce(stg.enabled, true)
       , coalesce(stg.mandatory, false)
       , coalesce(stg.sequence, 0)
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.features stg
   inner join config.modules mod
      on mod.slug = trim(stg.module_slug)
   where not exists (
     select 1
       from config.features f
      where f.module_id = mod.id
        and f.slug = trim(stg.slug)
        and f.modified_at > stg.modified_at
   )
      on conflict(module_id, slug)
      do update
            set title       = excluded.title
              , description = excluded.description
              , purpose     = excluded.purpose
              , benefit     = excluded.benefit
              , example     = excluded.example
              , enabled     = excluded.enabled
              , mandatory   = excluded.mandatory
              , sequence    = excluded.sequence
              , modified_by = excluded.modified_by
              , modified_at = excluded.modified_at;
end;
$$;
