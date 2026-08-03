set search_path to public, core, extensions;

-- O2 (§3.2 / §6 flow-8): batch-recompute the daily usage rollup for a tenant+day
-- from the authoritative inference_calls ledger, at the O2 §3.2 grain
-- (budget_node, served_model, provider, capability, plane). Idempotent — deletes
-- the day first, so a rerun reproduces the day exactly (a reconstructable cache,
-- never a parallel source of truth). Savings columns (cloud_equiv_usd/savings_usd)
-- stay at 0 here; the cheapest-cloud-step baseline is layered in by A3. p95 is
-- filled at reconcile (A4). Rows with no budget attribution are skipped (P5
-- guarantees a fail-closed org-root node, so this only drops upstream data bugs).
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
    (tenant_id, day, budget_node_id, served_model, provider, capability, execution_location,
     calls, input_tokens, output_tokens, cost_usd,
     fallback_calls, latency_ms_sum, latency_ms_count)
  select ic.tenant_id,
         p_day,
         ic.budget_node_id,
         ic.model,
         ic.adapter,
         ic.capability,
         coalesce(ic.execution_location, 'cloud'),
         count(*),
         coalesce(sum(ic.input_tokens), 0),
         coalesce(sum(ic.output_tokens), 0),
         coalesce(sum(ic.cost_usd), 0),
         count(*) filter (where ic.fallback_sequence > 0),
         coalesce(sum(ic.duration_ms), 0),
         count(*)
    from public.inference_calls ic
   where ic.tenant_id = p_tenant
     and ic.recorded_at >= p_day
     and ic.recorded_at <  p_day + interval '1 day'
     and ic.budget_node_id is not null
   group by ic.tenant_id, ic.budget_node_id, ic.model, ic.adapter, ic.capability,
            coalesce(ic.execution_location, 'cloud');
end;
$$;

revoke execute on function public.rollup_usage_daily(uuid, date) from public;
grant execute on function public.rollup_usage_daily(uuid, date) to service_role;

comment on function public.rollup_usage_daily is
'O2 §3.2: recompute the daily usage rollup for a tenant+day from inference_calls
at the full grain (node/model/provider/capability/plane). Idempotent; savings via
A3, p95 via A4. Reconstructable cache. service_role only.';
