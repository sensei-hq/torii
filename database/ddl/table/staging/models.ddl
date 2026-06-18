set search_path to staging;

create table if not exists models (
  provider_name            varchar(100) not null
, name                     varchar(100) not null
, version                  varchar(50) not null
, variant                  varchar(50)
, full_name                varchar(200) not null
, display_name             varchar(200)
, description              text
, context_window           integer
, max_output_tokens        integer
, training_data_cutoff     date
, parameters_count         bigint
, license_type             varchar(50)
, usage_guidelines         text
, content_policy_url       varchar(500)
, config                   jsonb
, released_on              date
, deprecated_on            date
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists models_ukey on models(provider_name, name, version, variant);
