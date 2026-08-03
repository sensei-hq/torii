-- O2 · analytics rollup schema (A1) + daily-rollup logic tests.
-- A1 asserts the O2 §3.2 shape: the two rollup TABLES (RLS + tenant SELECT,
-- writes revoked), the two materialized VIEWS (locked from authenticated —
-- MVs cannot carry RLS, so they are service_role-read-through-gateway only),
-- and the CONCURRENTLY-required unique indexes. Then the batch rollup logic.
\set ON_ERROR_STOP on
\echo '== O2 analytics: A1 schema shape =='

-- ─────────────────────────────────────────────────────────────────────────
-- A1.a — rollup table columns match O2 §3.2 exactly.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array[
    'tenant_id','day','budget_node_id','served_model','provider','capability','execution_location',
    'calls','input_tokens','output_tokens','cost_usd','cloud_equiv_usd','savings_usd',
    'fallback_calls','latency_ms_sum','latency_ms_count','latency_ms_p95',
    'local_only_calls','savings_unpriced_calls']) as c
  where not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='analytics_usage_daily'
                       and column_name = c);
  if missing is not null then
    raise exception 'FAIL: analytics_usage_daily missing columns: %', missing; end if;

  select string_agg(c, ', ') into missing
  from unnest(array[
    'tenant_id','day','budget_node_id','served_model',
    'grounding_avg','judge_score_avg','retrieval_precision_avg','retrieval_recall_avg',
    'guardrail_hit_calls','redaction_hit_calls','rated_calls','rating_avg',
    'thumb_up','thumb_down','accept_calls','edit_calls','retry_calls']) as c
  where not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='analytics_quality_daily'
                       and column_name = c);
  if missing is not null then
    raise exception 'FAIL: analytics_quality_daily missing columns: %', missing; end if;
  raise notice 'A1.a rollup-table columns ✓';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- A1.b — both materialized views exist WITH a unique index (REFRESH … CONCURRENTLY).
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare mv text;
begin
  foreach mv in array array['analytics_model_mix_daily','analytics_overview_current'] loop
    if not exists (select 1 from pg_matviews where schemaname='public' and matviewname = mv) then
      raise exception 'FAIL: materialized view public.% missing', mv; end if;
    if not exists (
      select 1 from pg_index i
       where i.indrelid = ('public.'||mv)::regclass and i.indisunique) then
      raise exception 'FAIL: %  has no UNIQUE index (REFRESH CONCURRENTLY would be illegal)', mv; end if;
  end loop;
  raise notice 'A1.b materialized views + unique indexes ✓';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- A1.c — RLS on the tables; writes revoked; MVs fully locked from authenticated.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  -- tables: RLS enabled + no client writes
  foreach t in array array['analytics_usage_daily','analytics_quality_daily'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.'||t)::regclass) then
      raise exception 'FAIL: RLS not enabled on %', t; end if;
    if has_table_privilege('authenticated','public.'||t,'INSERT')
       or has_table_privilege('authenticated','public.'||t,'UPDATE')
       or has_table_privilege('authenticated','public.'||t,'DELETE') then
      raise exception 'FAIL: authenticated can write % (must be service_role only)', t; end if;
  end loop;
  -- MVs: authenticated has NO access at all (no RLS on MVs → cross-tenant leak if granted)
  foreach t in array array['analytics_model_mix_daily','analytics_overview_current'] loop
    if has_table_privilege('authenticated','public.'||t,'SELECT')
       or has_table_privilege('anon','public.'||t,'SELECT') then
      raise exception 'FAIL: % is SELECTable by authenticated/anon (MVs cannot carry RLS)', t; end if;
  end loop;
  raise notice 'A1.c RLS + grant lockdown ✓';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- A1.d — batch daily rollup populates the new grain; idempotent.
-- ─────────────────────────────────────────────────────────────────────────
\echo '== O2 analytics: A1 rollup logic =='
begin;
  insert into public.inference_calls
    (tenant_id,id,capability,adapter,model,cost_usd,duration_ms,status,fallback_sequence,
     recorded_at,input_tokens,output_tokens,execution_location,budget_node_id) values
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f1','text_chat','anthropic','claude',0.01,100,'success',0,'2026-07-24T10:00:00Z',100,50,'cloud','b0de0000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f2','text_chat','anthropic','claude',0.02,120,'success',1,'2026-07-24T11:00:00Z',200,80,'cloud','b0de0000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f3','text_chat','ollama','gemma',0,90,'success',0,'2026-07-24T12:00:00Z',50,30,'local','b0de0000-0000-0000-0000-000000000001');

  select public.rollup_usage_daily('00000000-0000-0000-0000-000000000000','2026-07-24');

  do $$
  begin
    -- cloud/claude: 2 calls, 300 in, 130 out, 0.03 cost, 1 fallback call
    if (select calls from public.analytics_usage_daily
          where served_model='claude' and provider='anthropic' and capability='text_chat'
            and execution_location='cloud') <> 2
       or (select cost_usd from public.analytics_usage_daily
             where served_model='claude' and execution_location='cloud') <> 0.03
       or (select input_tokens from public.analytics_usage_daily
             where served_model='claude' and execution_location='cloud') <> 300
       or (select fallback_calls from public.analytics_usage_daily
             where served_model='claude' and execution_location='cloud') <> 1 then
      raise exception 'FAIL: cloud/claude rollup wrong'; end if;
    -- local/gemma: 1 call, $0
    if (select calls from public.analytics_usage_daily
          where served_model='gemma' and execution_location='local') <> 1
       or (select cost_usd from public.analytics_usage_daily
             where served_model='gemma' and execution_location='local') <> 0 then
      raise exception 'FAIL: local/gemma rollup wrong'; end if;
    -- idempotent: rerun does not double-count
    perform public.rollup_usage_daily('00000000-0000-0000-0000-000000000000','2026-07-24');
    if (select calls from public.analytics_usage_daily
          where served_model='claude' and execution_location='cloud') <> 2 then
      raise exception 'FAIL: rollup not idempotent (double-counted)'; end if;
    raise notice 'A1.d daily rollup + idempotency hold ✓';
  end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────
-- A2 — incremental fan-out on insert (triggers → analytics_rollup_apply).
-- ─────────────────────────────────────────────────────────────────────────
\echo '== O2 analytics: A2 incremental fan-out + triggers =='
begin;
  -- (1) inference_calls AFTER INSERT → analytics_rollup_apply → usage bucket appears
  --     with no application code path; replay is idempotent (no double-count).
  insert into public.inference_calls
    (tenant_id,id,capability,adapter,model,cost_usd,duration_ms,status,fallback_sequence,
     recorded_at,input_tokens,output_tokens,execution_location,budget_node_id) values
    ('00000000-0000-0000-0000-000000000000','a22a0000-0000-0000-0000-0000000000c1',
     'text_chat','anthropic','sonnet-4.6',0.0041,200,'success',0,
     '2026-07-25T09:00:00Z',120,60,'cloud','b0de0000-0000-0000-0000-000000000002');
  do $$
  begin
    if coalesce((select calls from public.analytics_usage_daily
          where served_model='sonnet-4.6' and execution_location='cloud'
            and budget_node_id='b0de0000-0000-0000-0000-000000000002'), -1) <> 1
       or coalesce((select cost_usd from public.analytics_usage_daily
             where served_model='sonnet-4.6' and execution_location='cloud'), -1) <> 0.0041
       or coalesce((select latency_ms_sum from public.analytics_usage_daily
             where served_model='sonnet-4.6' and execution_location='cloud'), -1) <> 200 then
      raise exception 'FAIL A2: AFTER INSERT did not fan out the usage bucket'; end if;
    -- replayed apply must NOT double-count (idempotent on inference_call_id)
    perform public.analytics_rollup_apply(
      '00000000-0000-0000-0000-000000000000'::uuid,'a22a0000-0000-0000-0000-0000000000c1'::uuid);
    if coalesce((select calls from public.analytics_usage_daily
          where served_model='sonnet-4.6' and execution_location='cloud'), -1) <> 1
       or coalesce((select cost_usd from public.analytics_usage_daily
             where served_model='sonnet-4.6' and execution_location='cloud'), -1) <> 0.0041 then
      raise exception 'FAIL A2: analytics_rollup_apply double-counted (not idempotent)'; end if;
    raise notice 'A2 usage fan-out + idempotency ✓';
  end $$;

  -- (2) quality_signals AFTER INSERT → recompute the call's quality bucket. Signals
  --     land AFTER the ledger row, so the quality path is driven by the signal insert,
  --     not the call insert; recompute is absolute → weighted averages are exact.
  insert into public.quality_signals
    (tenant_id,id,inference_call_id,signal_key,signal_class,value_num,source) values
    ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),
     'a22a0000-0000-0000-0000-0000000000c1','grounding','implicit',0.86,'test'),
    ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),
     'a22a0000-0000-0000-0000-0000000000c1','judge_score','implicit',0.91,'test');
  do $$
  begin
    if coalesce((select round(grounding_avg,2) from public.analytics_quality_daily
          where served_model='sonnet-4.6'
            and budget_node_id='b0de0000-0000-0000-0000-000000000002'), -1) <> 0.86
       or coalesce((select round(judge_score_avg,2) from public.analytics_quality_daily
             where served_model='sonnet-4.6'), -1) <> 0.91 then
      raise exception 'FAIL A2: quality_signals fan-out did not populate weighted averages'; end if;
    raise notice 'A2 quality fan-out (grounding/judge) ✓';
  end $$;
rollback;
\echo 'ANALYTICS A1+A2 TEST PASSED'
