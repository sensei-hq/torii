set search_path to staging;

create or replace procedure import_model_capabilities()
language plpgsql
as
$$
begin
  insert into config.model_capabilities(
     model_id, capability_id
   , capability_details, performance_metrics, limitations
   , supported, verified_by
   , modified_at, modified_by)
  select mdl.id as model_id
       , cap.id as capability_id
       , stg.capability_details
       , stg.performance_metrics
       , stg.limitations
       , true
       , 'seed'
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.model_capabilities stg
   inner join config.models mdl
      on mdl.full_name = lower(trim(stg.model_full_name))
   inner join catalog.capability_types cap
      on cap.name = trim(stg.capability_name)
   where not exists (select 1
                       from config.model_capabilities mc
                      where mc.model_id      = mdl.id
                        and mc.capability_id = cap.id
                        and mc.modified_at  > stg.modified_at)
      on conflict(model_id, capability_id)
      do update
            set capability_details  = excluded.capability_details
              , performance_metrics = excluded.performance_metrics
              , limitations         = excluded.limitations
              , modified_by         = excluded.modified_by
              , modified_at         = excluded.modified_at;
end;
$$;
