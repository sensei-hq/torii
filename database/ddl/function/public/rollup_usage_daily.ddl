set search_path to public, core, extensions;

-- O2 (RW15): roll up the authoritative inference_calls ledger into the daily
-- analytics cache for a tenant+day, grouped by model + execution plane. Idempotent
-- (recomputes the day) — a reconstructable cache, never a parallel source of truth.
create or replace function public.rollup_usage_daily(
  p_tenant uuid,
  p_day    date
) returns void
language plpgsql
as $$
begin
  delete from public.analytics_usage_daily
   where tenant_id = p_tenant and day = p_day;

  insert into public.analytics_usage_daily
    (tenant_id, day, model, plane, requests, input_tokens, output_tokens, cost_usd)
  select ic.tenant_id,
         p_day,
         ic.model,
         coalesce(ic.execution_location, 'cloud'),
         count(*),
         coalesce(sum(ic.input_tokens), 0),
         coalesce(sum(ic.output_tokens), 0),
         coalesce(sum(ic.cost_usd), 0)
    from public.inference_calls ic
   where ic.tenant_id = p_tenant
     and ic.recorded_at >= p_day
     and ic.recorded_at <  p_day + interval '1 day'
   group by ic.tenant_id, ic.model, coalesce(ic.execution_location, 'cloud');
end;
$$;

revoke execute on function public.rollup_usage_daily(uuid, date) from public;
grant execute on function public.rollup_usage_daily(uuid, date) to service_role;

comment on function public.rollup_usage_daily is
'O2/RW15: recompute the daily usage/cost rollup for a tenant+day from
inference_calls (by model + plane). Reconstructable cache. service_role only.';
