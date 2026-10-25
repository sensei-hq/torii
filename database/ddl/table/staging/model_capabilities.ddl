set search_path to staging;

create table if not exists model_capabilities (
  model_full_name          varchar not null
, capability_name          varchar not null
, capability_details       jsonb
, performance_metrics      jsonb
, limitations              jsonb
  -- Capability-learning fields the seed already carries.
, is_supported             boolean default true
, performance_tier         varchar
, verified_at              timestamp with time zone
, verified_by              varchar
, notes                    text
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists model_capabilities_ukey
    on model_capabilities(model_full_name, capability_name);
