set search_path to staging;

create table if not exists fallback_chain_models (
  chain_name                 varchar(100) not null
, router_name                varchar not null
, model_full_name            varchar not null
, sequence_order             integer not null
, max_retries                integer default 1
, is_active                  boolean default true
, modified_at                timestamp with time zone default now()
, modified_by                varchar default current_user
);

create unique index if not exists fallback_chain_models_ukey on fallback_chain_models(chain_name, sequence_order);
