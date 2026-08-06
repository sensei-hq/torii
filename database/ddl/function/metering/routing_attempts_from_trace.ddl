set search_path to metering, core, extensions;

-- §D Ledger Normalize (§112): AFTER INSERT on execution_traces → normalize the ExecutionTrace jsonb
-- `attempts[]` into metering.routing_attempts rows (one per attempt). Skips traces with no
-- inference_call_id (routing_attempts.inference_call_id is NOT NULL — a diagnostic trace not tied to a
-- billed call has nothing to attribute). plane is derived from the adapter name (mirrors store.rs:
-- embedded/ollama/llama = local, else cloud). SECURITY DEFINER (service_role) so it maintains the
-- normalized cache regardless of the writer's role; pinned search_path (no injection surface).
create or replace function metering.routing_attempts_from_trace()
returns trigger
language plpgsql
security definer
set search_path = metering, core, extensions
as $$
begin
  if NEW.inference_call_id is null then
    return null;  -- untied diagnostic trace → nothing to attribute
  end if;
  insert into metering.routing_attempts
    (tenant_id, inference_call_id, attempt_no, adapter, model, api_model_id,
     plane, latency_ms, outcome, cost_usd, error, fallback_triggered)
  select
    NEW.tenant_id,
    NEW.inference_call_id,
    coalesce((a->>'sequence')::smallint, 0),
    coalesce(a->>'adapter', ''),
    coalesce(a->>'model', ''),
    a->>'api_model_id',
    (case when coalesce(a->>'adapter','') ~ '(embedded|ollama|llama)'
          then 'local' else 'cloud' end)::core.execution_location,
    (a->>'duration_ms')::bigint,
    coalesce(a->>'status', ''),
    (a->>'cost')::numeric,
    a->>'error',
    coalesce((a->>'fallback_triggered')::boolean, false)
  from jsonb_array_elements(coalesce(NEW.trace->'attempts', '[]'::jsonb)) as a;
  return null;
end;
$$;

revoke execute on function metering.routing_attempts_from_trace() from public;
grant  execute on function metering.routing_attempts_from_trace() to service_role;

drop trigger if exists execution_traces_routing_attempts_ai on metering.execution_traces;
create trigger execution_traces_routing_attempts_ai
  after insert on metering.execution_traces
  for each row execute function metering.routing_attempts_from_trace();

comment on function metering.routing_attempts_from_trace is
'§D Ledger Normalize (§112): normalize execution_traces.trace attempts[] → metering.routing_attempts
rows on insert. Skips untied traces (null inference_call_id). service_role only.';
