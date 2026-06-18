set search_path to staging;

create table if not exists model_endpoints (
  router_name                    varchar not null
, provider_name                  varchar not null
, model_full_name                varchar not null
, capability_name                varchar not null
, region                         varchar(100)
, endpoint_url                   text not null
, router_model_id                varchar(200)
, priority                       integer default 0
, cost_per_input_token           decimal(12,10) not null default 0
, cost_per_output_token          decimal(12,10) not null default 0
, cost_per_request               decimal(10,6) default 0
, max_tokens_input               integer
, max_tokens_output              integer
, max_requests_per_minute        integer default 1000
, max_tokens_per_minute          integer default 1000
, max_concurrent_requests        integer default 1
, supports_streaming             boolean default true
, supports_function_calls        boolean default false
, connection_config              jsonb
, headers                        jsonb
, authentication_config          jsonb
, timeout_seconds                integer default 30
, retry_attempts                 integer default 3
, retry_delay_ms                 integer default 1000
, circuit_breaker_enabled        boolean default true
, circuit_breaker_threshold      integer default 5
, circuit_breaker_window_minutes integer default 15
, health_check_enabled           boolean default true
, health_check_url               text
, health_check_interval_seconds  integer default 300
, is_active                      boolean default true
, is_default                     boolean default false
, notes                          text
, modified_at                    timestamp with time zone default now()
, modified_by                    varchar default current_user
);

create unique index if not exists model_endpoints_ukey
    on model_endpoints(router_name, provider_name, model_full_name, capability_name);
