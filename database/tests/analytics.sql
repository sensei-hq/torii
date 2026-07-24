-- O2 · daily usage rollup — aggregates the ledger by model + plane; idempotent.
\set ON_ERROR_STOP on
\echo '== O2 rollup_usage_daily =='
begin;
  insert into public.inference_calls(tenant_id,id,capability,adapter,model,cost_usd,duration_ms,status,fallback_sequence,recorded_at,input_tokens,output_tokens,execution_location) values
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f1','text_chat','anthropic','claude',0.01,100,'success',0,'2026-07-24T10:00:00Z',100,50,'cloud'),
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f2','text_chat','anthropic','claude',0.02,120,'success',0,'2026-07-24T11:00:00Z',200,80,'cloud'),
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f3','text_chat','ollama','gemma',0,90,'success',0,'2026-07-24T12:00:00Z',50,30,'local');

  select public.rollup_usage_daily('00000000-0000-0000-0000-000000000000','2026-07-24');

  do $$
  begin
    -- cloud/claude: 2 requests, 300 in, 130 out, 0.03 cost
    if (select requests from public.analytics_usage_daily where model='claude' and plane='cloud') <> 2
       or (select cost_usd from public.analytics_usage_daily where model='claude' and plane='cloud') <> 0.03
       or (select input_tokens from public.analytics_usage_daily where model='claude' and plane='cloud') <> 300 then
      raise exception 'FAIL: cloud/claude rollup wrong'; end if;
    -- local/gemma: 1 request, $0
    if (select requests from public.analytics_usage_daily where model='gemma' and plane='local') <> 1 then
      raise exception 'FAIL: local/gemma rollup wrong'; end if;
    -- idempotent: rerun does not double-count
    perform public.rollup_usage_daily('00000000-0000-0000-0000-000000000000','2026-07-24');
    if (select requests from public.analytics_usage_daily where model='claude' and plane='cloud') <> 2 then
      raise exception 'FAIL: rollup not idempotent (double-counted)'; end if;
    raise notice 'O2 daily rollup + idempotency hold ✓';
  end $$;
rollback;
\echo 'ANALYTICS ROLLUP TEST PASSED'
