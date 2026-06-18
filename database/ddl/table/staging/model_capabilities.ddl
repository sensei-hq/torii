set search_path to staging;

create table if not exists model_capabilities (
  model_full_name          varchar not null
, capability_name          varchar not null
, capability_details       jsonb
, performance_metrics      jsonb
, limitations              jsonb
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists model_capabilities_ukey
    on model_capabilities(model_full_name, capability_name);
