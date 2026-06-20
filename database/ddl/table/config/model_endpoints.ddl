-- database/ddl/table/config/model_endpoints.ddl
set search_path to config, extensions;

create table if not exists model_endpoints (
  id                             uuid primary key default uuid_generate_v4()
, model_id                       uuid not null references models(id)
, router_id                      uuid not null references routers(id)
, capability_id                  uuid references capabilities(id)
, region                         varchar(100)
, endpoint_url                   text not null
, router_model_id                varchar(200)
, priority                       integer default 0
, cost_per_input_token           decimal(12,10) not null default 0
, cost_per_output_token          decimal(12,10) not null default 0
, cost_per_request               decimal(10,6) default 0
, cost_per_image                 decimal(10,6) default 0
, cost_per_second                decimal(10,6) default 0
, max_tokens_input               integer
, max_tokens_output              integer
, max_requests_per_minute        integer default 1000
, max_tokens_per_minute          integer default 1000
, max_concurrent_requests        integer default 1
, supports_streaming             boolean default true
, supports_function_calls        boolean default false
, local_capable                  boolean not null default false
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
, modified_at                    timestamp with time zone not null default now()
, modified_by                    varchar
);

create unique index if not exists model_endpoints_ukey on model_endpoints(model_id, router_id, capability_id);
create index if not exists model_endpoints_fkey1 on model_endpoints(model_id);
create index if not exists model_endpoints_fkey2 on model_endpoints(router_id);
create index if not exists model_endpoints_fkey3 on model_endpoints(capability_id);
create index if not exists model_endpoints_idx1 on model_endpoints(region);
create index if not exists model_endpoints_idx2 on model_endpoints(priority);
create index if not exists model_endpoints_idx3 on model_endpoints(is_active);
create index if not exists model_endpoints_idx4 on model_endpoints(is_default);
create index if not exists model_endpoints_idx5 on model_endpoints(model_id, router_id);
create index if not exists model_endpoints_idx6 on model_endpoints(capability_id, priority);
create index if not exists model_endpoints_idx7 on model_endpoints(cost_per_input_token);
create index if not exists model_endpoints_idx8 on model_endpoints(cost_per_output_token);

comment on table model_endpoints IS
'Router-model-capability bindings with pricing, rate limits, and health config.
- Moved from public to config schema — reference data, not tenant-specific
- Links AI models to specific router services with router-specific pricing
- Supports multiple endpoints per model through different routers
- Includes circuit breaker patterns, health checks, and failover configuration
- local_capable: true if this endpoint can run on-device (gateway-embedded) for the split-plane router';
