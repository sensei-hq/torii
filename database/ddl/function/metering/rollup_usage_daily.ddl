set search_path to metering, public, core, extensions;

-- O2 (§3.2 / §6 flow-8): batch-recompute the daily usage rollup for a tenant+day
-- from the authoritative inference_calls ledger, at the O2 §3.2 grain
-- (budget_node, served_model, provider, capability, plane). Idempotent — deletes
-- the day first, so a rerun reproduces the day exactly (a reconstructable cache,
-- never a parallel source of truth). Savings columns (cloud_equiv_usd/savings_usd)
-- stay at 0 here; the cheapest-cloud-step baseline is layered in by A3. p95 is
-- filled at reconcile (A4). Rows with no budget attribution are skipped (P5
-- guarantees a fail-closed org-root node, so this only drops upstream data bugs).
create or replace function metering.rollup_usage_daily(
  p_tenant uuid,
  p_day    date
) returns void
language plpgsql
as $$
begin
  delete from metering.usage_daily
   where tenant_id = p_tenant and day = p_day;

  insert into metering.usage_daily
    (tenant_id, day, org_unit_id, served_model, provider, capability, execution_location,
     pool_key,
     calls, input_tokens, output_tokens, cost_usd,
     fallback_calls, latency_ms_sum, latency_ms_count)
  select ic.tenant_id,
         p_day,
         ic.org_unit_id,
         ic.model,
         ic.adapter,
         ic.capability,
         coalesce(ic.execution_location, 'cloud'),
         -- G3: resolve the free-tier pool from the call's model. max() because pool_key is
         -- functionally determined by model_id, so every row in the group agrees — it is an
         -- aggregate only to satisfy GROUP BY, not a choice between differing values.
         --
         -- ⚠ Resolved from the catalog AS IT IS NOW, not as it was on p_day. Re-pooling a
         -- model therefore re-attributes its history on the next rerun. Accepted: pool
         -- membership is a property of the provider's terms (it changes when the provider
         -- changes them, which is when history genuinely should follow), and the alternative
         -- — snapshotting pool_key onto every inference_calls row — needs the gateway write
         -- path, which is a later increment. The `re-run reproduces the day exactly` contract
         -- above holds for a fixed catalog.
         max(m.free_pool_key),
         count(*),
         coalesce(sum(ic.input_tokens), 0),
         coalesce(sum(ic.output_tokens), 0),
         coalesce(sum(ic.cost_actual), 0),
         count(*) filter (where ic.fallback_sequence > 0),
         coalesce(sum(ic.duration_ms), 0),
         count(*)
    from metering.inference_calls ic
    -- LEFT: a call whose model_id is unresolved (or whose model has no free tier) still
    -- rolls up; it simply carries no pool. An inner join would silently drop usage.
    left join catalog.models m on m.id = ic.model_id
   where ic.tenant_id = p_tenant
     and ic.recorded_at >= p_day
     and ic.recorded_at <  p_day + interval '1 day'
     and ic.org_unit_id is not null
   group by ic.tenant_id, ic.org_unit_id, ic.model, ic.adapter, ic.capability,
            coalesce(ic.execution_location, 'cloud');
end;
$$;

revoke execute on function metering.rollup_usage_daily(uuid, date) from public;
grant execute on function metering.rollup_usage_daily(uuid, date) to service_role;

comment on function metering.rollup_usage_daily is
'O2 §3.2: recompute the daily usage rollup for a tenant+day from inference_calls
at the full grain (node/model/provider/capability/plane). Idempotent; savings via
A3, p95 via A4. Reconstructable cache. service_role only.';
