-- database/ddl/procedure/staging/import_fallback_chain_models.ddl
set search_path to staging;

create or replace procedure import_fallback_chain_models()
language plpgsql
as
$$
declare
  v_platform_id uuid;
begin
  select id into v_platform_id from core.tenants where is_platform = true limit 1;

  insert into public.fallback_chain_models(
     tenant_id, fallback_chain_id, router_id, model_id
   , sequence_order, max_retries, is_active
   , modified_at, modified_by)
  select v_platform_id as tenant_id
       , fcc.id as fallback_chain_id
       , rtr.id as router_id
       , mdl.id as model_id
       , stg.sequence_order
       , stg.max_retries
       , stg.is_active
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.fallback_chain_models stg
   inner join public.fallback_chains fcc
      on fcc.tenant_id = v_platform_id
     and fcc.name      = trim(stg.chain_name)
   inner join catalog.routers rtr
      on rtr.name = trim(stg.router_name)
   inner join catalog.models mdl
      on mdl.full_name = lower(trim(stg.model_full_name))
   where not exists (
     select 1
       from public.fallback_chain_models fcm2
      where fcm2.tenant_id         = v_platform_id
        and fcm2.fallback_chain_id = fcc.id
        and fcm2.sequence_order    = stg.sequence_order
        and fcm2.modified_at       > coalesce(stg.modified_at, now())
   )
  on conflict (tenant_id, fallback_chain_id, sequence_order)
  do update
        set router_id    = excluded.router_id
          , model_id     = excluded.model_id
          , max_retries  = excluded.max_retries
          , is_active    = excluded.is_active
          , modified_by  = excluded.modified_by
          , modified_at  = excluded.modified_at;
end;
$$;
