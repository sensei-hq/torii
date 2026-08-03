set search_path to public, core, extensions;

-- O2 §6 flow-1 / §9 AC-2: incremental fan-out for ONE completed call. Reads the single
-- inference_calls row + its quality_signals and maintains the two rollup buckets:
--   • USAGE (analytics_usage_daily) — incremented once per call. Idempotent on
--     inference_call_id via analytics_applied_calls: only the FIRST apply increments,
--     so a replayed/retriggered apply cannot double-count. Savings columns are
--     accrued here via analytics_cloud_equiv (cheapest cloud step, §8 baseline).
--   • QUALITY (analytics_quality_daily) — ABSOLUTE recompute of this call's
--     (day,node,model) bucket from quality_signals. Runs on every apply because C6
--     writes signals AFTER the ledger row (so the quality path is driven by the
--     quality_signals trigger, not the call insert); absolute recompute is idempotent
--     and picks up late-arriving signals. signal_key → column mirrors the C6 taxonomy
--     (docs/specs/C6 §3.3 / quality-signals descriptor) — extend here as C6 emits more.
-- SECURITY DEFINER (service_role) with a pinned search_path (no injection surface).
create or replace function public.analytics_rollup_apply(
  p_tenant  uuid,
  p_call_id uuid
) returns void
language plpgsql
security definer
set search_path = public, core, extensions
as $$
declare
  v_call        public.inference_calls%rowtype;
  v_first       boolean;
  v_day         date;
  v_ce          numeric;   -- baseline cloud_equiv from analytics_cloud_equiv
  v_lo          boolean;   -- local-only (no cloud counterfactual)
  v_up          boolean;   -- unpriced counterfactual
  v_cloud_equiv numeric := 0;
  v_savings     numeric := 0;
  v_local_only  int     := 0;
  v_unpriced    int     := 0;
begin
  select * into v_call from public.inference_calls
   where tenant_id = p_tenant and id = p_call_id;
  if not found or v_call.budget_node_id is null then
    return;  -- no such call, or unattributed (P5 fail-closes to an org root) → skip
  end if;
  v_day := v_call.recorded_at::date;

  -- Savings baseline (§8): cloud calls' counterfactual = their actual cost (savings 0);
  -- local calls get the cheapest-cloud-step baseline, with local-only/unpriced surfaced.
  if coalesce(v_call.execution_location, 'cloud') = 'local' then
    select cloud_equiv_usd, is_local_only, is_unpriced into v_ce, v_lo, v_up
      from public.analytics_cloud_equiv(
             v_call.tenant_id, v_call.chain_id,
             coalesce(v_call.input_tokens, 0), coalesce(v_call.output_tokens, 0));
    if v_lo then
      v_local_only := 1;                              -- excluded from savings, counted
    elsif v_up then
      v_unpriced := 1;                                -- excluded from savings, counted
    else
      v_cloud_equiv := coalesce(v_ce, 0);
      v_savings     := greatest(v_cloud_equiv - coalesce(v_call.cost_usd, 0), 0);
    end if;
  else
    v_cloud_equiv := coalesce(v_call.cost_usd, 0);    -- cloud: counterfactual = actual
  end if;

  -- Idempotency: mark the call; USAGE increments only on the first application.
  insert into public.analytics_applied_calls(tenant_id, inference_call_id)
       values (p_tenant, p_call_id)
  on conflict (tenant_id, inference_call_id) do nothing;
  v_first := found;

  if v_first then
    insert into public.analytics_usage_daily
      (tenant_id, day, budget_node_id, served_model, provider, capability, execution_location,
       calls, input_tokens, output_tokens, cost_usd, cloud_equiv_usd, savings_usd,
       fallback_calls, latency_ms_sum, latency_ms_count, local_only_calls, savings_unpriced_calls)
    values
      (v_call.tenant_id, v_day, v_call.budget_node_id, v_call.model, v_call.adapter,
       v_call.capability, coalesce(v_call.execution_location, 'cloud'),
       1, coalesce(v_call.input_tokens, 0), coalesce(v_call.output_tokens, 0),
       coalesce(v_call.cost_usd, 0), v_cloud_equiv, v_savings,
       case when v_call.fallback_sequence > 0 then 1 else 0 end,
       coalesce(v_call.duration_ms, 0), 1, v_local_only, v_unpriced)
    on conflict (tenant_id, day, budget_node_id, served_model, provider, capability, execution_location)
    do update set
       calls                  = analytics_usage_daily.calls + 1,
       input_tokens           = analytics_usage_daily.input_tokens  + coalesce(v_call.input_tokens, 0),
       output_tokens          = analytics_usage_daily.output_tokens + coalesce(v_call.output_tokens, 0),
       cost_usd               = analytics_usage_daily.cost_usd        + coalesce(v_call.cost_usd, 0),
       cloud_equiv_usd        = analytics_usage_daily.cloud_equiv_usd + v_cloud_equiv,
       savings_usd            = analytics_usage_daily.savings_usd     + v_savings,
       fallback_calls         = analytics_usage_daily.fallback_calls  + case when v_call.fallback_sequence > 0 then 1 else 0 end,
       latency_ms_sum         = analytics_usage_daily.latency_ms_sum  + coalesce(v_call.duration_ms, 0),
       latency_ms_count       = analytics_usage_daily.latency_ms_count + 1,
       local_only_calls       = analytics_usage_daily.local_only_calls + v_local_only,
       savings_unpriced_calls = analytics_usage_daily.savings_unpriced_calls + v_unpriced;
  end if;

  -- QUALITY: absolute recompute of the call's (day,node,model) bucket from signals.
  insert into public.analytics_quality_daily
    (tenant_id, day, budget_node_id, served_model,
     grounding_avg, judge_score_avg, retrieval_precision_avg, retrieval_recall_avg,
     guardrail_hit_calls, redaction_hit_calls, rated_calls, rating_avg,
     thumb_up, thumb_down, accept_calls, edit_calls, retry_calls)
  select v_call.tenant_id, v_day, v_call.budget_node_id, v_call.model,
     avg(qs.value_num)                     filter (where qs.signal_key = 'grounding'),
     avg(qs.value_num)                     filter (where qs.signal_key = 'judge_score'),
     avg(qs.value_num)                     filter (where qs.signal_key = 'retrieval_precision'),
     avg(qs.value_num)                     filter (where qs.signal_key = 'retrieval_recall'),
     count(distinct qs.inference_call_id)  filter (where qs.signal_key = 'guardrail_hit'),
     count(distinct qs.inference_call_id)  filter (where qs.signal_key = 'redaction' and coalesce(qs.value_num, 1) > 0),
     count(distinct qs.inference_call_id)  filter (where qs.signal_key = 'rating'),
     avg(qs.value_num)                     filter (where qs.signal_key = 'rating'),
     count(*)                              filter (where qs.signal_key = 'thumb_up'),
     count(*)                              filter (where qs.signal_key = 'thumb_down'),
     count(distinct qs.inference_call_id)  filter (where qs.signal_key = 'accept'),
     count(distinct qs.inference_call_id)  filter (where qs.signal_key = 'edit'),
     count(distinct qs.inference_call_id)  filter (where qs.signal_key = 'retry')
    from public.quality_signals qs
    join public.inference_calls ic
      on ic.tenant_id = qs.tenant_id and ic.id = qs.inference_call_id
   where ic.tenant_id  = v_call.tenant_id
     and ic.recorded_at >= v_day
     and ic.recorded_at <  v_day + interval '1 day'
     and ic.budget_node_id = v_call.budget_node_id
     and ic.model = v_call.model
  having count(qs.id) > 0
  on conflict (tenant_id, day, budget_node_id, served_model)
  do update set
     grounding_avg           = excluded.grounding_avg,
     judge_score_avg         = excluded.judge_score_avg,
     retrieval_precision_avg = excluded.retrieval_precision_avg,
     retrieval_recall_avg    = excluded.retrieval_recall_avg,
     guardrail_hit_calls     = excluded.guardrail_hit_calls,
     redaction_hit_calls     = excluded.redaction_hit_calls,
     rated_calls             = excluded.rated_calls,
     rating_avg              = excluded.rating_avg,
     thumb_up                = excluded.thumb_up,
     thumb_down              = excluded.thumb_down,
     accept_calls            = excluded.accept_calls,
     edit_calls              = excluded.edit_calls,
     retry_calls             = excluded.retry_calls;
end;
$$;

revoke execute on function public.analytics_rollup_apply(uuid, uuid) from public;
grant  execute on function public.analytics_rollup_apply(uuid, uuid) to service_role;

comment on function public.analytics_rollup_apply is
'O2 §6 flow-1: incremental fan-out for one call — usage bucket incremented once
(idempotent via analytics_applied_calls), quality bucket absolute-recomputed from
quality_signals, savings accrued via analytics_cloud_equiv (cheapest cloud step).
SECURITY DEFINER, service_role only.';
