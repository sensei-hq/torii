set search_path to metering, public, core, extensions;

-- O2 §3.2 / §6 flow-1: AFTER INSERT fan-out into the rollup cache. Two feeds funnel
-- into analytics_rollup_apply (one function, idempotent):
--   • inference_calls → usage bucket (cost/tokens/latency/fallback are known at insert).
--   • quality_signals → recompute the referenced call's quality bucket (signals are
--     written AFTER the ledger row, so the quality path is driven here, not by the
--     inference_calls trigger). C5 event-level signals (no inference_call_id) are skipped.
-- Returns NULL (AFTER ROW). SECURITY DEFINER so it can maintain the service_role cache
-- regardless of the writer's role; pinned search_path (no injection surface).
create or replace function metering.fanout()
returns trigger
language plpgsql
security definer
set search_path = metering, public, core, extensions
as $$
begin
  if TG_TABLE_NAME = 'inference_calls' then
    perform metering.rollup_apply(NEW.tenant_id, NEW.id);
  elsif TG_TABLE_NAME = 'quality_signals' and NEW.inference_call_id is not null then
    perform metering.rollup_apply(NEW.tenant_id, NEW.inference_call_id);
  end if;
  return null;
end;
$$;

drop trigger if exists inference_calls_analytics_ai on metering.inference_calls;
create trigger inference_calls_analytics_ai
  after insert on metering.inference_calls
  for each row execute function metering.fanout();

drop trigger if exists quality_signals_analytics_ai on metering.quality_signals;
create trigger quality_signals_analytics_ai
  after insert on metering.quality_signals
  for each row execute function metering.fanout();

comment on function metering.fanout() is
'O2 §6 flow-1: AFTER INSERT fan-out. inference_calls → usage; quality_signals →
quality recompute (via analytics_rollup_apply). service_role cache maintenance.';
