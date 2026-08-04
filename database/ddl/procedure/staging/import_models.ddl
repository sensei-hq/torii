set search_path to staging;

create or replace procedure import_models()
language plpgsql
as
$$
begin
  insert into catalog.models(
     provider_id, name, version, variant, full_name
   , display_name, description, context_window, max_output_tokens
   , training_data_cutoff, parameters_count, license_type
   , usage_guidelines, content_policy_url, config
   , released_on, deprecated_on, modified_at, modified_by)
  select p.id as provider_id
       , lower(trim(stg.name))
       , lower(trim(stg.version))
       , lower(nullif(trim(stg.variant), ''))
       , lower(trim(stg.full_name))
       , stg.display_name, stg.description
       , stg.context_window, stg.max_output_tokens
       , stg.training_data_cutoff, stg.parameters_count, stg.license_type
       , stg.usage_guidelines, stg.content_policy_url, stg.config
       , stg.released_on, stg.deprecated_on
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.models stg
   inner join catalog.providers p
      on p.name = trim(stg.provider_name)
   where not exists (select 1
                       from catalog.models m
                      where m.provider_id = p.id
                        and m.name        = lower(trim(stg.name))
                        and m.version     = lower(trim(stg.version))
                        and m.variant is not distinct from lower(nullif(trim(stg.variant), ''))
                        and m.modified_at >= stg.modified_at)
      on conflict(provider_id, full_name)
      do update
            set full_name            = excluded.full_name
              , display_name         = excluded.display_name
              , description          = excluded.description
              , context_window       = excluded.context_window
              , max_output_tokens    = excluded.max_output_tokens
              , training_data_cutoff = excluded.training_data_cutoff
              , parameters_count     = excluded.parameters_count
              , license_type         = excluded.license_type
              , usage_guidelines     = excluded.usage_guidelines
              , content_policy_url   = excluded.content_policy_url
              , config               = excluded.config
              , released_on          = excluded.released_on
              , deprecated_on        = excluded.deprecated_on
              , modified_by          = excluded.modified_by
              , modified_at          = excluded.modified_at;
end;
$$;
