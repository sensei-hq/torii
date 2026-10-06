-- G3 — free-tier quota accounting: pools and reset windows.
--
-- WHY THIS EXISTS: a free-tier allowance is consumed PER POOL, not per model, and it RESETS.
-- Without both facts, "how much of this free tier is left?" cannot be answered — which is why
-- the gateway's `headroom` and `least_used` intra-tier strategies currently stub to `priority`
-- with a warn!, and why usage metering and predicted lockout are unbuilt. This is the data
-- they are missing.
--
-- Two ways to get it silently wrong, both pinned below:
--   · summing per-model allowances double-counts a shared pool (60M + 60M = 120M for a pool
--     that only ever grants 60M) — an inflated headline that reads like a real number;
--   · counting usage across all time instead of the current window shows a tier as exhausted
--     forever once it has been used, so routing avoids a model that is in fact free again.
\set ON_ERROR_STOP on
\echo '== metering: free-tier pools + reset windows =='

-- Fixtures live under a dedicated tenant + org unit so the suite's other rollup assertions
-- (analytics.sql) are untouched.
\set T '\'00000000-0000-0000-0000-0000000000g3\''

-- ─────────────────────────────────────────────────────────────────────────
-- P1 — usage_daily carries the pool dimension.
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'metering' and table_name = 'usage_daily' and column_name = 'pool_key')
  then raise exception 'FAIL P1: metering.usage_daily.pool_key does not exist'; end if;
  raise notice 'PASSED P1: usage_daily carries pool_key';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- P2–P6 — one fixture: a shared pool (two models, 60M each on ONE allowance),
--         an un-pooled free model, and an uncapped one.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  tid uuid; pid uuid; unit uuid;
  m_a uuid; m_b uuid; m_solo uuid; m_unc uuid;
  n bigint; allowance bigint; used bigint; rem bigint; ws date;
begin
  select id into tid from core.tenants where is_platform limit 1;
  select id into pid from catalog.providers limit 1;
  select id into unit from core.org_units where tenant_id = tid limit 1;
  if tid is null or pid is null or unit is null then
    raise notice 'SKIPPED P2-P6: no platform tenant / provider / org unit seeded'; return; end if;

  -- two models sharing pool 'g3-flash', each documenting the SAME 60M allowance
  insert into catalog.models (provider_id, name, version, full_name, free_type, free_tos, free_monthly_tokens, free_pool_key)
    values (pid, 'g3-flash-a', 'v1', 'g3-flash-a-v1', 'recurring_monthly', 'ok', 60000000, 'g3-flash')
    returning id into m_a;
  insert into catalog.models (provider_id, name, version, full_name, free_type, free_tos, free_monthly_tokens, free_pool_key)
    values (pid, 'g3-flash-b', 'v1', 'g3-flash-b-v1', 'recurring_monthly', 'ok', 60000000, 'g3-flash')
    returning id into m_b;
  -- un-pooled: stands alone on its own allowance
  insert into catalog.models (provider_id, name, version, full_name, free_type, free_tos, free_monthly_tokens)
    values (pid, 'g3-solo', 'v1', 'g3-solo-v1', 'recurring_monthly', 'ok', 10000000)
    returning id into m_solo;
  -- uncapped: free forever, no finite allowance to divide into
  insert into catalog.models (provider_id, name, version, full_name, free_type, free_tos, free_pool_key)
    values (pid, 'g3-unc', 'v1', 'g3-unc-v1', 'recurring_uncapped', 'ok', 'g3-unlimited')
    returning id into m_unc;

  -- Usage: 10M tokens on EACH pooled model THIS window, plus 50M last month on one of them
  -- (the out-of-window row that must not count), and 1M on the un-pooled model.
  insert into metering.inference_calls
    (tenant_id, id, capability, adapter, model, model_id, cost_actual, duration_ms, status,
     fallback_sequence, recorded_at, input_tokens, output_tokens, execution_location, org_unit_id)
  values
    (tid, gen_random_uuid(), 'text_chat', 'g3', 'g3-flash-a-v1', m_a, 0, 10, 'success', 0,
     date_trunc('month', current_date) + interval '2 days', 6000000, 4000000, 'cloud', unit),
    (tid, gen_random_uuid(), 'text_chat', 'g3', 'g3-flash-b-v1', m_b, 0, 10, 'success', 0,
     date_trunc('month', current_date) + interval '3 days', 6000000, 4000000, 'cloud', unit),
    (tid, gen_random_uuid(), 'text_chat', 'g3', 'g3-solo-v1', m_solo, 0, 10, 'success', 0,
     date_trunc('month', current_date) + interval '4 days', 600000, 400000, 'cloud', unit),
    -- LAST month — same pool, must be excluded by the window
    (tid, gen_random_uuid(), 'text_chat', 'g3', 'g3-flash-a-v1', m_a, 0, 10, 'success', 0,
     date_trunc('month', current_date) - interval '20 days', 30000000, 20000000, 'cloud', unit);

  -- roll up every day the fixture touches
  perform metering.rollup_usage_daily(tid, d::date)
     from generate_series(date_trunc('month', current_date)::date - 25,
                          current_date, interval '1 day') d;

  -- P2 — the rollup resolved each call's pool from its model.
  select count(*) into n from metering.usage_daily
   where tenant_id = tid and pool_key = 'g3-flash';
  if n < 2 then
    raise exception 'FAIL P2: expected >=2 usage_daily rows keyed to pool g3-flash, got %', n; end if;
  if exists (select 1 from metering.usage_daily
              where tenant_id = tid and served_model = 'g3-solo-v1' and pool_key is not null) then
    raise exception 'FAIL P2: an un-pooled model was given a pool_key'; end if;
  raise notice 'PASSED P2: rollup resolves pool_key from the call''s model';

  -- P3/P4 — headroom: the shared pool grants 60M ONCE, not 120M.
  select allowance_tokens, used_tokens, remaining_tokens, window_start
    into allowance, used, rem, ws
    from metering.pool_headroom where tenant_id = tid and pool_key = 'g3-flash';
  if allowance is null then
    raise exception 'FAIL P3: no headroom row for pool g3-flash'; end if;
  if allowance <> 60000000 then
    raise exception 'FAIL P4: pool allowance = %, expected 60000000 counted ONCE (not 120000000)', allowance; end if;
  raise notice 'PASSED P3/P4: a shared pool grants its allowance once (60M, not 120M)';

  -- P5 — the window excludes last month. Both pooled models used 10M each THIS month = 20M;
  --      the 50M from last month must not appear.
  if used <> 20000000 then
    raise exception 'FAIL P5: used = % this window, expected 20000000 (the 50M from last month must not count)', used; end if;
  if rem <> 40000000 then
    raise exception 'FAIL P5: remaining = %, expected 40000000 (60M - 20M)', rem; end if;
  if ws is distinct from date_trunc('month', current_date)::date then
    raise exception 'FAIL P5: window_start = %, expected the start of this month', ws; end if;
  raise notice 'PASSED P5: the reset window excludes prior-window usage (20M used, 40M left)';

  -- P6 — an uncapped tier has NO finite allowance. Reporting 0 would read as "exhausted"
  --      and route traffic away from a model that is free and available.
  select allowance_tokens, remaining_tokens into allowance, rem
    from metering.pool_headroom where tenant_id = tid and pool_key = 'g3-unlimited';
  if allowance is not null then
    raise exception 'FAIL P6: uncapped pool reported allowance %, expected NULL (not a number)', allowance; end if;
  if rem is not null then
    raise exception 'FAIL P6: uncapped pool reported remaining %, expected NULL', rem; end if;
  raise notice 'PASSED P6: an uncapped tier reports NULL allowance, never 0';

  -- Clean up on `provider`, which EVERY fixture row carries. Keying on `pool_key like 'g3-%'`
  -- silently left the un-pooled row behind (its pool_key is NULL by design), and that stray
  -- row then failed authz.sql's cross-tenant analytics count — a leaked fixture reported as a
  -- tenant leak. Match on the column that is always present, not the one under test.
  delete from metering.inference_calls where tenant_id = tid and adapter = 'g3';
  delete from metering.usage_daily where tenant_id = tid and provider = 'g3';
  delete from catalog.models where name like 'g3-%';
end $$;

\echo '== metering pool tests complete =='
