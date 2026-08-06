-- O2 · analytics rollup schema (A1) + daily-rollup logic tests.
-- A1 asserts the O2 §3.2 shape: the two rollup TABLES (RLS + tenant SELECT,
-- writes revoked), the two materialized VIEWS (locked from authenticated —
-- MVs cannot carry RLS, so they are service_role-read-through-gateway only),
-- and the CONCURRENTLY-required unique indexes. Then the batch rollup logic.
\set ON_ERROR_STOP on
-- Fresh-build robustness: catalog.routers/capabilities are name-keyed seeds whose ids are
-- assigned at import (random per build), so fixtures must DERIVE ids, never hardcode them.
-- rid/cid back the A3+A4 cloud-equivalent-pricing fixtures (client-side vars persist across
-- the begin/rollback blocks). A hardcoded id passes only on a stale DB — never a fresh build.
select id as rid from catalog.routers      order by id limit 1 \gset
select id as cid from catalog.capability_types order by id limit 1 \gset
\echo '== O2 analytics: A1 schema shape =='

-- ─────────────────────────────────────────────────────────────────────────
-- A1.a — rollup table columns match O2 §3.2 exactly.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array[
    'tenant_id','day','org_unit_id','served_model','provider','capability','execution_location',
    'calls','input_tokens','output_tokens','cost_usd','cloud_equiv_usd','savings_usd',
    'fallback_calls','latency_ms_sum','latency_ms_count','latency_ms_p95',
    'local_only_calls','savings_unpriced_calls']) as c
  where not exists (select 1 from information_schema.columns
                     where table_schema='metering' and table_name='usage_daily'
                       and column_name = c);
  if missing is not null then
    raise exception 'FAIL: analytics_usage_daily missing columns: %', missing; end if;

  select string_agg(c, ', ') into missing
  from unnest(array[
    'tenant_id','day','org_unit_id','served_model',
    'grounding_avg','judge_score_avg','retrieval_precision_avg','retrieval_recall_avg',
    'guardrail_hit_calls','redaction_hit_calls','rated_calls','rating_avg',
    'thumb_up','thumb_down','accept_calls','edit_calls','retry_calls']) as c
  where not exists (select 1 from information_schema.columns
                     where table_schema='metering' and table_name='quality_daily'
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
  foreach mv in array array['model_mix_daily','overview_current'] loop
    if not exists (select 1 from pg_matviews where schemaname='metering' and matviewname = mv) then
      raise exception 'FAIL: materialized view metering.% missing', mv; end if;
    if not exists (
      select 1 from pg_index i
       where i.indrelid = ('metering.'||mv)::regclass and i.indisunique) then
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
  foreach t in array array['usage_daily','quality_daily'] loop
    if not (select relrowsecurity from pg_class where oid = ('metering.'||t)::regclass) then
      raise exception 'FAIL: RLS not enabled on %', t; end if;
    if has_table_privilege('authenticated','metering.'||t,'INSERT')
       or has_table_privilege('authenticated','metering.'||t,'UPDATE')
       or has_table_privilege('authenticated','metering.'||t,'DELETE') then
      raise exception 'FAIL: authenticated can write % (must be service_role only)', t; end if;
  end loop;
  -- MVs: authenticated has NO access at all (no RLS on MVs → cross-tenant leak if granted)
  foreach t in array array['model_mix_daily','overview_current'] loop
    if has_table_privilege('authenticated','metering.'||t,'SELECT')
       or has_table_privilege('anon','metering.'||t,'SELECT') then
      raise exception 'FAIL: % is SELECTable by authenticated/anon (MVs cannot carry RLS)', t; end if;
  end loop;
  raise notice 'A1.c RLS + grant lockdown ✓';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- A1.d — batch daily rollup populates the new grain; idempotent.
-- ─────────────────────────────────────────────────────────────────────────
\echo '== O2 analytics: A1 rollup logic =='

-- §D Ledger Normalize LN-3c: inference_calls.org_unit_id now FKs → core.org_units, so the test
-- attribution ids must exist. Seed them (idempotent) for the platform tenant; level 0 (seeded in
-- unit_levels by P5). Harmless persistence (no node/member → invisible to budget_tree/org reads).
insert into core.org_units (tenant_id, id, parent_id, level, name, modified_by)
select '00000000-0000-0000-0000-000000000000', v.id::uuid, null, 0, 'test-unit', 'test'
from (values ('b0de0000-0000-0000-0000-000000000001'),('b0de0000-0000-0000-0000-000000000002'),
             ('b0de0000-0000-0000-0000-0000000000a1'),('b0de0000-0000-0000-0000-0000000000a2'),
             ('b0de0000-0000-0000-0000-0000000000a3'),('b0de0000-0000-0000-0000-0000000000a4'),
             ('b0de0000-0000-0000-0000-0000000000b1'),('b0de0000-0000-0000-0000-0000000000b2')) as v(id)
on conflict (tenant_id, id) do nothing;

begin;
  insert into metering.inference_calls
    (tenant_id,id,capability,adapter,model,cost_actual,duration_ms,status,fallback_sequence,
     recorded_at,input_tokens,output_tokens,execution_location,org_unit_id) values
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f1','text_chat','anthropic','claude',0.01,100,'success',0,'2026-07-24T10:00:00Z',100,50,'cloud','b0de0000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f2','text_chat','anthropic','claude',0.02,120,'success',1,'2026-07-24T11:00:00Z',200,80,'cloud','b0de0000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000000','a11a0000-0000-0000-0000-0000000000f3','text_chat','ollama','gemma',0,90,'success',0,'2026-07-24T12:00:00Z',50,30,'local','b0de0000-0000-0000-0000-000000000001');

  select metering.rollup_usage_daily('00000000-0000-0000-0000-000000000000','2026-07-24');

  do $$
  begin
    -- cloud/claude: 2 calls, 300 in, 130 out, 0.03 cost, 1 fallback call
    if (select calls from metering.usage_daily
          where served_model='claude' and provider='anthropic' and capability='text_chat'
            and execution_location='cloud') <> 2
       or (select cost_usd from metering.usage_daily
             where served_model='claude' and execution_location='cloud') <> 0.03
       or (select input_tokens from metering.usage_daily
             where served_model='claude' and execution_location='cloud') <> 300
       or (select fallback_calls from metering.usage_daily
             where served_model='claude' and execution_location='cloud') <> 1 then
      raise exception 'FAIL: cloud/claude rollup wrong'; end if;
    -- local/gemma: 1 call, $0
    if (select calls from metering.usage_daily
          where served_model='gemma' and execution_location='local') <> 1
       or (select cost_usd from metering.usage_daily
             where served_model='gemma' and execution_location='local') <> 0 then
      raise exception 'FAIL: local/gemma rollup wrong'; end if;
    -- idempotent: rerun does not double-count
    perform metering.rollup_usage_daily('00000000-0000-0000-0000-000000000000','2026-07-24');
    if (select calls from metering.usage_daily
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
  insert into metering.inference_calls
    (tenant_id,id,capability,adapter,model,cost_actual,duration_ms,status,fallback_sequence,
     recorded_at,input_tokens,output_tokens,execution_location,org_unit_id) values
    ('00000000-0000-0000-0000-000000000000','a22a0000-0000-0000-0000-0000000000c1',
     'text_chat','anthropic','sonnet-4.6',0.0041,200,'success',0,
     '2026-07-25T09:00:00Z',120,60,'cloud','b0de0000-0000-0000-0000-000000000002');
  do $$
  begin
    if coalesce((select calls from metering.usage_daily
          where served_model='sonnet-4.6' and execution_location='cloud'
            and org_unit_id='b0de0000-0000-0000-0000-000000000002'), -1) <> 1
       or coalesce((select cost_usd from metering.usage_daily
             where served_model='sonnet-4.6' and execution_location='cloud'), -1) <> 0.0041
       or coalesce((select latency_ms_sum from metering.usage_daily
             where served_model='sonnet-4.6' and execution_location='cloud'), -1) <> 200 then
      raise exception 'FAIL A2: AFTER INSERT did not fan out the usage bucket'; end if;
    -- replayed apply must NOT double-count (idempotent on inference_call_id)
    perform metering.rollup_apply(
      '00000000-0000-0000-0000-000000000000'::uuid,'a22a0000-0000-0000-0000-0000000000c1'::uuid);
    if coalesce((select calls from metering.usage_daily
          where served_model='sonnet-4.6' and execution_location='cloud'), -1) <> 1
       or coalesce((select cost_usd from metering.usage_daily
             where served_model='sonnet-4.6' and execution_location='cloud'), -1) <> 0.0041 then
      raise exception 'FAIL A2: analytics_rollup_apply double-counted (not idempotent)'; end if;
    raise notice 'A2 usage fan-out + idempotency ✓';
  end $$;

  -- (2) quality_signals AFTER INSERT → recompute the call's quality bucket. Signals
  --     land AFTER the ledger row, so the quality path is driven by the signal insert,
  --     not the call insert; recompute is absolute → weighted averages are exact.
  insert into metering.quality_signals
    (tenant_id,id,subject_type,inference_call_id,signal_key,signal_class,value_num,source) values
    ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'call',
     'a22a0000-0000-0000-0000-0000000000c1','grounding','implicit',0.86,'test'),
    ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'call',
     'a22a0000-0000-0000-0000-0000000000c1','judge_score','implicit',0.91,'test');
  do $$
  begin
    if coalesce((select round(grounding_avg,2) from metering.quality_daily
          where served_model='sonnet-4.6'
            and org_unit_id='b0de0000-0000-0000-0000-000000000002'), -1) <> 0.86
       or coalesce((select round(judge_score_avg,2) from metering.quality_daily
             where served_model='sonnet-4.6'), -1) <> 0.91 then
      raise exception 'FAIL A2: quality_signals fan-out did not populate weighted averages'; end if;
    raise notice 'A2 quality fan-out (grounding/judge) ✓';
  end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────
-- A3 — cloud-equivalent savings baseline (cheapest cloud step, actual tokens).
-- Fixtures reuse an existing router + capability (FKs) and add fresh models +
-- chains so pricing is deterministic. All in one rolled-back transaction.
-- ─────────────────────────────────────────────────────────────────────────
\echo '== O2 analytics: A3 cloud-equivalent savings baseline =='
begin;
  -- fixture models (catalog.models: name+version required; id defaulted → set explicit)
  insert into catalog.models (id, name, version) values
    ('a3300000-0000-0000-0000-000000000001','sav-cloud-cheap','1'),
    ('a3300000-0000-0000-0000-000000000002','sav-cloud-dear','1'),
    ('a3300000-0000-0000-0000-000000000003','sav-cloud-unpriced','1'),
    ('a3300000-0000-0000-0000-000000000004','sav-local-only','1');
  -- endpoints price the cloud counterfactual (reuse the derived seed router :rid + capability :cid)
  insert into catalog.model_endpoints
    (id, model_id, router_id, capability_id, endpoint_url, cost_per_input_token, cost_per_output_token, is_active) values
    ('a3310000-0000-0000-0000-000000000001','a3300000-0000-0000-0000-000000000001',:'rid',:'cid','http://t',0.00001,0.00003,true),
    ('a3310000-0000-0000-0000-000000000002','a3300000-0000-0000-0000-000000000002',:'rid',:'cid','http://t',0.00002,0.00006,true);
  -- NB: model sav-cloud-unpriced (…003) intentionally has NO endpoint → its cloud
  -- step is unpriced (no ModelPricing), which the baseline must surface, not guess.
  -- four chains (tenant 0 owns them → effective_chain_models first branch)
  insert into catalog.chains (id, tenant_id, name, capability_id, is_active, modified_by) values
    ('a3320000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','sav-cloud',:'cid',true,'test'),
    ('a3320000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','sav-local',:'cid',true,'test'),
    ('a3320000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','sav-unpriced',:'cid',true,'test'),
    ('a3320000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','sav-two',:'cid',true,'test');
  insert into catalog.chain_models
    (id, tenant_id, fallback_chain_id, router_id, model_id, sequence_order, plane, is_active, modified_by) values
    -- sav-cloud: one cheap cloud step
    ('a3330000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','a3320000-0000-0000-0000-000000000001',:'rid','a3300000-0000-0000-0000-000000000001',1,'cloud',true,'test'),
    -- sav-local: only a LOCAL step (no cloud counterfactual)
    ('a3330000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','a3320000-0000-0000-0000-000000000002',:'rid','a3300000-0000-0000-0000-000000000004',1,'local',true,'test'),
    -- sav-unpriced: a cloud step whose endpoint has NULL pricing
    ('a3330000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','a3320000-0000-0000-0000-000000000003',:'rid','a3300000-0000-0000-0000-000000000003',1,'cloud',true,'test'),
    -- sav-two: cheap + dear cloud steps → cheapest must win
    ('a3330000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','a3320000-0000-0000-0000-000000000004',:'rid','a3300000-0000-0000-0000-000000000001',1,'cloud',true,'test'),
    ('a3330000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','a3320000-0000-0000-0000-000000000004',:'rid','a3300000-0000-0000-0000-000000000002',2,'cloud',true,'test');

  -- four LOCAL calls (cost 0, in=512 out=128), one per chain, distinct budget nodes.
  insert into metering.inference_calls
    (tenant_id,id,capability,adapter,model,cost_actual,duration_ms,status,fallback_sequence,
     recorded_at,input_tokens,output_tokens,execution_location,chain_id,org_unit_id) values
    ('00000000-0000-0000-0000-000000000000','a33c0000-0000-0000-0000-000000000001','text_chat','ollama','local-x',0,90,'success',0,'2026-07-26T09:00:00Z',512,128,'local','sav-cloud',   'b0de0000-0000-0000-0000-0000000000a1'),
    ('00000000-0000-0000-0000-000000000000','a33c0000-0000-0000-0000-000000000002','text_chat','ollama','local-x',0,90,'success',0,'2026-07-26T09:00:00Z',512,128,'local','sav-local',   'b0de0000-0000-0000-0000-0000000000a2'),
    ('00000000-0000-0000-0000-000000000000','a33c0000-0000-0000-0000-000000000003','text_chat','ollama','local-x',0,90,'success',0,'2026-07-26T09:00:00Z',512,128,'local','sav-unpriced','b0de0000-0000-0000-0000-0000000000a3'),
    ('00000000-0000-0000-0000-000000000000','a33c0000-0000-0000-0000-000000000004','text_chat','ollama','local-x',0,90,'success',0,'2026-07-26T09:00:00Z',512,128,'local','sav-two',     'b0de0000-0000-0000-0000-0000000000a4');

  do $$
  declare c1 numeric; s1 numeric; s4 numeric; lo2 bigint; up3 bigint;
  begin
    -- case 1: priced cloud step → 512·0.00001 + 128·0.00003 = 0.00896
    select cloud_equiv_usd, savings_usd into c1, s1 from metering.usage_daily
      where org_unit_id='b0de0000-0000-0000-0000-0000000000a1' and execution_location='local';
    if coalesce(c1,-1) <> 0.00896 or coalesce(s1,-1) <> 0.00896 then
      raise exception 'FAIL A3 priced: cloud_equiv=% savings=% (want 0.00896)', c1, s1; end if;

    -- case 2: local-only chain → no counterfactual, counted separately
    select local_only_calls into lo2 from metering.usage_daily
      where org_unit_id='b0de0000-0000-0000-0000-0000000000a2' and execution_location='local';
    if coalesce(lo2,-1) <> 1
       or coalesce((select savings_usd from metering.usage_daily
                     where org_unit_id='b0de0000-0000-0000-0000-0000000000a2'),-1) <> 0 then
      raise exception 'FAIL A3 local-only: local_only_calls=% (want 1, savings 0)', lo2; end if;

    -- case 3: unpriced counterfactual → excluded, surfaced, never guessed
    select savings_unpriced_calls into up3 from metering.usage_daily
      where org_unit_id='b0de0000-0000-0000-0000-0000000000a3' and execution_location='local';
    if coalesce(up3,-1) <> 1
       or coalesce((select savings_usd from metering.usage_daily
                     where org_unit_id='b0de0000-0000-0000-0000-0000000000a3'),-1) <> 0 then
      raise exception 'FAIL A3 unpriced: savings_unpriced_calls=% (want 1, savings 0)', up3; end if;

    -- case 4: cheapest-of-two wins → 0.00896 (< the dear step's 0.01792)
    select savings_usd into s4 from metering.usage_daily
      where org_unit_id='b0de0000-0000-0000-0000-0000000000a4' and execution_location='local';
    if coalesce(s4,-1) <> 0.00896 or s4 >= 0.01792 then
      raise exception 'FAIL A3 conservative floor: savings=% (want cheapest 0.00896)', s4; end if;

    raise notice 'A3 savings baseline (priced/local-only/unpriced/conservative-floor) ✓';
  end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────
-- A4 — MV refresh + reconciliation (reconstructable cache; drift audited to O1).
-- ─────────────────────────────────────────────────────────────────────────
\echo '== O2 analytics: A4 MV refresh + reconcile =='
-- refresh runs at top level: REFRESH … CONCURRENTLY needs the unique indexes (A1)
-- and cannot run inside the rolled-back txn below. Must not error.
select metering.refresh_mviews();

begin;
  -- minimal priced cloud chain so savings reconstructability is exercised
  insert into catalog.models (id, name, version) values
    ('a4400000-0000-0000-0000-000000000001','recon-cloud','1');
  insert into catalog.model_endpoints
    (id, model_id, router_id, capability_id, endpoint_url, cost_per_input_token, cost_per_output_token, is_active)
    values ('a4410000-0000-0000-0000-000000000001','a4400000-0000-0000-0000-000000000001',
            :'rid',:'cid','http://t',0.00001,0.00003,true);
  insert into catalog.chains (id, tenant_id, name, capability_id, is_active, modified_by)
    values ('a4420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
            'recon-chain',:'cid',true,'test');
  insert into catalog.chain_models
    (id, tenant_id, fallback_chain_id, router_id, model_id, sequence_order, plane, is_active, modified_by)
    values ('a4430000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
            'a4420000-0000-0000-0000-000000000001',:'rid',
            'a4400000-0000-0000-0000-000000000001',1,'cloud',true,'test');

  -- 3 cloud calls (one bucket; latencies 100/200/300) + 1 local call (savings bucket)
  insert into metering.inference_calls
    (tenant_id,id,capability,adapter,model,cost_actual,duration_ms,status,fallback_sequence,
     recorded_at,input_tokens,output_tokens,execution_location,chain_id,org_unit_id) values
    ('00000000-0000-0000-0000-000000000000','a44c0000-0000-0000-0000-000000000001','text_chat','anthropic','sonnet-4.6',0.01,100,'success',0,'2026-07-27T09:00:00Z',100,50,'cloud','recon-chain','b0de0000-0000-0000-0000-0000000000b1'),
    ('00000000-0000-0000-0000-000000000000','a44c0000-0000-0000-0000-000000000002','text_chat','anthropic','sonnet-4.6',0.01,200,'success',0,'2026-07-27T10:00:00Z',100,50,'cloud','recon-chain','b0de0000-0000-0000-0000-0000000000b1'),
    ('00000000-0000-0000-0000-000000000000','a44c0000-0000-0000-0000-000000000003','text_chat','anthropic','sonnet-4.6',0.01,300,'success',0,'2026-07-27T11:00:00Z',100,50,'cloud','recon-chain','b0de0000-0000-0000-0000-0000000000b1'),
    ('00000000-0000-0000-0000-000000000000','a44c0000-0000-0000-0000-000000000004','text_chat','ollama','local-x',0,90,'success',0,'2026-07-27T12:00:00Z',512,128,'local','recon-chain','b0de0000-0000-0000-0000-0000000000b2');

  do $$
  declare pre_calls bigint; pre_cost numeric; pre_sav numeric; n0 bigint;
  begin
    -- incremental (trigger-produced) figures
    select calls, cost_usd into pre_calls, pre_cost from metering.usage_daily
      where org_unit_id='b0de0000-0000-0000-0000-0000000000b1' and execution_location='cloud';
    select savings_usd into pre_sav from metering.usage_daily
      where org_unit_id='b0de0000-0000-0000-0000-0000000000b2' and execution_location='local';
    if coalesce(pre_calls,-1) <> 3 or coalesce(pre_cost,-1) <> 0.03 or coalesce(pre_sav,-1) <> 0.00896 then
      raise exception 'A4 setup wrong: pre calls=% cost=% sav=%', pre_calls, pre_cost, pre_sav; end if;

    -- reconstructability: zero the rollups → reconcile rebuilds identical figures.
    delete from metering.usage_daily   where tenant_id='00000000-0000-0000-0000-000000000000' and day='2026-07-27';
    delete from metering.quality_daily where tenant_id='00000000-0000-0000-0000-000000000000' and day='2026-07-27';
    perform metering.rollup_reconcile('00000000-0000-0000-0000-000000000000','2026-07-27');
    if coalesce((select calls    from metering.usage_daily where org_unit_id='b0de0000-0000-0000-0000-0000000000b1' and execution_location='cloud'),-1) <> 3
       or coalesce((select cost_usd from metering.usage_daily where org_unit_id='b0de0000-0000-0000-0000-0000000000b1'),-1) <> 0.03
       or coalesce((select savings_usd from metering.usage_daily where org_unit_id='b0de0000-0000-0000-0000-0000000000b2'),-1) <> 0.00896 then
      raise exception 'FAIL A4 reconstructability: figures not rebuilt from the ledger alone'; end if;
    -- p95 computed at reconcile: percentile_cont(0.95) over {100,200,300} = 290
    if coalesce((select latency_ms_p95 from metering.usage_daily
                  where org_unit_id='b0de0000-0000-0000-0000-0000000000b1'),-1) <> 290 then
      raise exception 'FAIL A4: latency_ms_p95 not computed at reconcile'; end if;
    raise notice 'A4 reconstructability + p95 ✓';

    -- drift: corrupt a bucket, reconcile → corrected AND one analytics.reconciled audit row.
    select count(*) into n0 from audit.audit_events
      where tenant_id='00000000-0000-0000-0000-000000000000' and action='analytics.reconciled';
    update metering.usage_daily set calls = calls + 100
      where org_unit_id='b0de0000-0000-0000-0000-0000000000b1';
    perform metering.rollup_reconcile('00000000-0000-0000-0000-000000000000','2026-07-27');
    if coalesce((select calls from metering.usage_daily
                  where org_unit_id='b0de0000-0000-0000-0000-0000000000b1'),-1) <> 3 then
      raise exception 'FAIL A4 drift: corrupted bucket not corrected'; end if;
    if (select count(*) from audit.audit_events
          where tenant_id='00000000-0000-0000-0000-000000000000' and action='analytics.reconciled') <> n0 + 1 then
      raise exception 'FAIL A4 drift: analytics.reconciled audit row not emitted for the drift'; end if;
    raise notice 'A4 drift correction + audit ✓';
  end $$;
rollback;
\echo 'ANALYTICS A1+A2+A3+A4 TEST PASSED'
