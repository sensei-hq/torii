set search_path to public, config, core, extensions;

-- O2 §6 flow-8 / §9 AC-1/AC-11 — reconcile a day against the immutable ledger. Full
-- recompute of analytics_usage_daily + analytics_quality_daily for (tenant, day) from
-- inference_calls + quality_signals ALONE, so zeroing the rollups and reconciling every
-- day reproduces identical figures (rollups are a reconstructable cache, never a source
-- of truth). Per-call savings are re-priced via analytics_cloud_equiv (matches the
-- incremental fan-out); latency p95 is computed here (percentile_cont). Idempotent
-- (delete-then-recompute). Drift beyond tolerance emits an analytics.reconciled audit
-- row to O1 (mirrors C3 flow-10 budget.reconciled), so a corrected number is auditable.
create or replace function public.analytics_rollup_reconcile(
  p_tenant uuid,
  p_day    date
) returns void
language plpgsql
security definer
set search_path = public, config, core, extensions
as $$
declare
  v_pre_calls   bigint  := 0; v_post_calls   bigint  := 0;
  v_pre_cost    numeric := 0; v_post_cost    numeric := 0;
  v_pre_savings numeric := 0; v_post_savings numeric := 0;
begin
  select coalesce(sum(calls), 0), coalesce(sum(cost_usd), 0), coalesce(sum(savings_usd), 0)
    into v_pre_calls, v_pre_cost, v_pre_savings
    from public.analytics_usage_daily where tenant_id = p_tenant and day = p_day;

  -- USAGE: recompute from the ledger. Per-call savings via analytics_cloud_equiv (same
  -- logic as the fan-out); p95 via percentile_cont over the day's durations.
  delete from public.analytics_usage_daily where tenant_id = p_tenant and day = p_day;
  insert into public.analytics_usage_daily
    (tenant_id, day, budget_node_id, served_model, provider, capability, execution_location,
     calls, input_tokens, output_tokens, cost_usd, cloud_equiv_usd, savings_usd,
     fallback_calls, latency_ms_sum, latency_ms_count, latency_ms_p95,
     local_only_calls, savings_unpriced_calls)
  with per_call as (
    select
      ic.tenant_id, ic.budget_node_id, ic.model as served_model, ic.adapter as provider,
      ic.capability, coalesce(ic.execution_location, 'cloud') as plane,
      coalesce(ic.input_tokens, 0)  as in_tok,
      coalesce(ic.output_tokens, 0) as out_tok,
      coalesce(ic.cost_usd, 0)      as cost_usd,
      coalesce(ic.duration_ms, 0)   as duration_ms,
      ic.fallback_sequence,
      case when coalesce(ic.execution_location, 'cloud') = 'cloud' then coalesce(ic.cost_usd, 0)
           when ce.is_local_only or ce.is_unpriced then 0
           else coalesce(ce.cloud_equiv_usd, 0) end as ce_usd,
      case when coalesce(ic.execution_location, 'cloud') = 'cloud' then 0
           when ce.is_local_only or ce.is_unpriced then 0
           else greatest(coalesce(ce.cloud_equiv_usd, 0) - coalesce(ic.cost_usd, 0), 0) end as sav_usd,
      case when coalesce(ic.execution_location, 'cloud') = 'local' and ce.is_local_only then 1 else 0 end as lo,
      case when coalesce(ic.execution_location, 'cloud') = 'local' and ce.is_unpriced   then 1 else 0 end as up
    from public.inference_calls ic
    left join lateral public.analytics_cloud_equiv(
                ic.tenant_id, ic.chain_id, coalesce(ic.input_tokens, 0), coalesce(ic.output_tokens, 0)) ce
      on coalesce(ic.execution_location, 'cloud') = 'local'
    where ic.tenant_id = p_tenant
      and ic.recorded_at >= p_day
      and ic.recorded_at <  p_day + interval '1 day'
      and ic.budget_node_id is not null
  )
  select
    tenant_id, p_day, budget_node_id, served_model, provider, capability, plane,
    count(*), sum(in_tok), sum(out_tok), sum(cost_usd), sum(ce_usd), sum(sav_usd),
    count(*) filter (where fallback_sequence > 0),
    sum(duration_ms), count(*),
    percentile_cont(0.95) within group (order by duration_ms)::integer,
    sum(lo), sum(up)
  from per_call
  group by tenant_id, budget_node_id, served_model, provider, capability, plane;

  -- QUALITY: recompute from quality_signals (same signal_key → column map as the fan-out).
  delete from public.analytics_quality_daily where tenant_id = p_tenant and day = p_day;
  insert into public.analytics_quality_daily
    (tenant_id, day, budget_node_id, served_model,
     grounding_avg, judge_score_avg, retrieval_precision_avg, retrieval_recall_avg,
     guardrail_hit_calls, redaction_hit_calls, rated_calls, rating_avg,
     thumb_up, thumb_down, accept_calls, edit_calls, retry_calls)
  select ic.tenant_id, p_day, ic.budget_node_id, ic.model,
     avg(qs.value_num)                    filter (where qs.signal_key = 'grounding'),
     avg(qs.value_num)                    filter (where qs.signal_key = 'judge_score'),
     avg(qs.value_num)                    filter (where qs.signal_key = 'retrieval_precision'),
     avg(qs.value_num)                    filter (where qs.signal_key = 'retrieval_recall'),
     count(distinct qs.inference_call_id) filter (where qs.signal_key = 'guardrail_hit'),
     count(distinct qs.inference_call_id) filter (where qs.signal_key = 'redaction' and coalesce(qs.value_num, 1) > 0),
     count(distinct qs.inference_call_id) filter (where qs.signal_key = 'rating'),
     avg(qs.value_num)                    filter (where qs.signal_key = 'rating'),
     count(*)                             filter (where qs.signal_key = 'thumb_up'),
     count(*)                             filter (where qs.signal_key = 'thumb_down'),
     count(distinct qs.inference_call_id) filter (where qs.signal_key = 'accept'),
     count(distinct qs.inference_call_id) filter (where qs.signal_key = 'edit'),
     count(distinct qs.inference_call_id) filter (where qs.signal_key = 'retry')
    from public.quality_signals qs
    join public.inference_calls ic
      on ic.tenant_id = qs.tenant_id and ic.id = qs.inference_call_id
   where ic.tenant_id  = p_tenant
     and ic.recorded_at >= p_day and ic.recorded_at < p_day + interval '1 day'
     and ic.budget_node_id is not null
   group by ic.tenant_id, ic.budget_node_id, ic.model;

  -- Mark every reconciled call so a later incremental apply cannot re-add it.
  insert into public.analytics_applied_calls (tenant_id, inference_call_id)
    select p_tenant, ic.id from public.inference_calls ic
     where ic.tenant_id = p_tenant
       and ic.recorded_at >= p_day and ic.recorded_at < p_day + interval '1 day'
  on conflict (tenant_id, inference_call_id) do nothing;

  -- Drift audit (O1): emit only when the reconcile actually moved a figure.
  select coalesce(sum(calls), 0), coalesce(sum(cost_usd), 0), coalesce(sum(savings_usd), 0)
    into v_post_calls, v_post_cost, v_post_savings
    from public.analytics_usage_daily where tenant_id = p_tenant and day = p_day;
  if v_pre_calls <> v_post_calls
     or abs(v_pre_cost - v_post_cost)       > 0.000001
     or abs(v_pre_savings - v_post_savings) > 0.000001 then
    insert into audit.audit_events (tenant_id, action, target_type, data)
    values (p_tenant, 'analytics.reconciled', 'analytics_usage_daily',
            jsonb_build_object(
              'day',      p_day,
              'calls',    jsonb_build_object('before', v_pre_calls,   'after', v_post_calls),
              'cost_usd', jsonb_build_object('before', v_pre_cost,    'after', v_post_cost),
              'savings',  jsonb_build_object('before', v_pre_savings, 'after', v_post_savings)));
  end if;
end;
$$;

revoke execute on function public.analytics_rollup_reconcile(uuid, date) from public;
grant  execute on function public.analytics_rollup_reconcile(uuid, date) to service_role;

comment on function public.analytics_rollup_reconcile is
'O2 §6 flow-8: recompute a day''s usage+quality rollups from the immutable ledger
(reconstructable cache), re-pricing savings via analytics_cloud_equiv and computing
p95. Idempotent; drift emits an analytics.reconciled audit row (O1). service_role only.';
