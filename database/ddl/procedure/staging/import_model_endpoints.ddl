set search_path to staging;

create or replace procedure import_model_endpoints()
language plpgsql
as
$$
begin
  insert into config.model_endpoints(
     model_id, router_id, capability_id
   , region, endpoint_url, router_model_id, priority
   , cost_per_input_token, cost_per_output_token, cost_per_request
   , max_tokens_input, max_tokens_output
   , max_requests_per_minute, max_tokens_per_minute, max_concurrent_requests
   , supports_streaming, supports_function_calls
   , connection_config, headers, authentication_config
   , timeout_seconds, retry_attempts, retry_delay_ms
   , circuit_breaker_enabled, circuit_breaker_threshold, circuit_breaker_window_minutes
   , health_check_enabled, health_check_url, health_check_interval_seconds
   , is_active, is_default, notes
   , modified_at, modified_by)
  select m.id, r.id, c.id
       , stg.region, stg.endpoint_url, stg.router_model_id
       , coalesce(stg.priority, 0)
       , coalesce(stg.cost_per_input_token, 0)
       , coalesce(stg.cost_per_output_token, 0)
       , coalesce(stg.cost_per_request, 0)
       , stg.max_tokens_input, stg.max_tokens_output
       , coalesce(stg.max_requests_per_minute, 1000)
       , coalesce(stg.max_tokens_per_minute, 1000)
       , coalesce(stg.max_concurrent_requests, 1)
       , coalesce(stg.supports_streaming, true)
       , coalesce(stg.supports_function_calls, false)
       , stg.connection_config, stg.headers, stg.authentication_config
       , coalesce(stg.timeout_seconds, 30)
       , coalesce(stg.retry_attempts, 3)
       , coalesce(stg.retry_delay_ms, 1000)
       , coalesce(stg.circuit_breaker_enabled, true)
       , coalesce(stg.circuit_breaker_threshold, 5)
       , coalesce(stg.circuit_breaker_window_minutes, 15)
       , coalesce(stg.health_check_enabled, true)
       , stg.health_check_url
       , coalesce(stg.health_check_interval_seconds, 300)
       , coalesce(stg.is_active, true)
       , coalesce(stg.is_default, false)
       , stg.notes
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.model_endpoints stg
   inner join config.routers r
      on r.name = trim(stg.router_name)
   inner join config.providers p
      on p.name = trim(stg.provider_name)
   inner join config.models m
      on m.provider_id = p.id
     and m.full_name = lower(trim(stg.model_full_name))
   inner join config.capabilities c
      on c.name = trim(stg.capability_name)
   where not exists (select 1
                       from config.model_endpoints me
                      where me.router_id = r.id
                        and me.model_id = m.id
                        and me.capability_id = c.id
                        and me.modified_at > stg.modified_at)
      on conflict(model_id, router_id, capability_id)
      do update
            set region                         = excluded.region
              , endpoint_url                   = excluded.endpoint_url
              , router_model_id                = excluded.router_model_id
              , priority                       = excluded.priority
              , cost_per_input_token           = excluded.cost_per_input_token
              , cost_per_output_token          = excluded.cost_per_output_token
              , cost_per_request               = excluded.cost_per_request
              , max_tokens_input               = excluded.max_tokens_input
              , max_tokens_output              = excluded.max_tokens_output
              , max_requests_per_minute        = excluded.max_requests_per_minute
              , max_tokens_per_minute          = excluded.max_tokens_per_minute
              , max_concurrent_requests        = excluded.max_concurrent_requests
              , supports_streaming             = excluded.supports_streaming
              , supports_function_calls        = excluded.supports_function_calls
              , connection_config              = excluded.connection_config
              , headers                        = excluded.headers
              , authentication_config          = excluded.authentication_config
              , timeout_seconds                = excluded.timeout_seconds
              , retry_attempts                 = excluded.retry_attempts
              , retry_delay_ms                 = excluded.retry_delay_ms
              , circuit_breaker_enabled        = excluded.circuit_breaker_enabled
              , circuit_breaker_threshold      = excluded.circuit_breaker_threshold
              , circuit_breaker_window_minutes = excluded.circuit_breaker_window_minutes
              , health_check_enabled           = excluded.health_check_enabled
              , health_check_url               = excluded.health_check_url
              , health_check_interval_seconds  = excluded.health_check_interval_seconds
              , is_active                      = excluded.is_active
              , is_default                     = excluded.is_default
              , notes                          = excluded.notes
              , modified_by                    = excluded.modified_by
              , modified_at                    = excluded.modified_at;
end;
$$;
