-- G5 — operator-tunable resilience policy, mirroring the engine's ResilienceConfig.
--
-- WHY A NEW TABLE AND NOT catalog.routing_policies: routing_policies is keyed
-- (tenant_id, chain_id) — PER CHAIN. ResilienceConfig is PROCESS-GLOBAL: one
-- `Gateway::with_resilience` call configures the whole gateway, and there is exactly one
-- cooldown store, one lockout store and one performance window per process, shared by every
-- tenant. Storing it per chain would let two chains in one tenant declare different eviction
-- caps while the engine can honour only one — config that looks applied and silently is not.
-- torii-gateway is one multi-tenant process, so this is DEPLOYMENT config, not tenant config.
--
-- THE TRAP THIS PINS: the engine's defaults "reproduce the prior hardcoded behavior exactly".
-- If torii's column defaults drift from them, then simply HAVING a row changes production
-- routing behaviour — silently, and in a way that looks like configuration rather than a bug.
-- R1 pins every default against the engine's constants.
\set ON_ERROR_STOP on
\echo '== resilience config: engine-default parity + guardrails =='

-- ─────────────────────────────────────────────────────────────────────────
-- R1 — every default equals the engine's, unit-converted. The engine holds
--      Durations; we store milliseconds, so these are the ms equivalents of
--      crates/gateway/src/resilience.rs + gates/lockout.rs defaults.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  expected constant text[][] := array[
    ['cooldown_base_ms',        '30000'],     -- Duration::from_secs(30)
    ['eviction_cap',            '4096'],      -- DEFAULT_EVICTION_CAP
    ['jitter_fraction',         '0.0'],       -- off; a real Retry-After is never jittered
    ['perf_samples',            '64'],        -- DEFAULT_PERF_SAMPLES
    ['perf_window_ms',          '300000'],    -- DEFAULT_PERF_WINDOW = 300s
    ['min_samples',             '3'],         -- DEFAULT_MIN_SAMPLES
    ['lockout_rate_limit_base_ms', '60000'],  -- ModelLockoutPolicy::rate_limit_base  60s
    ['lockout_quota_default_ms',   '3600000'],-- ModelLockoutPolicy::quota_default   3600s
    ['lockout_max_cooldown_ms',    '21600000']-- ModelLockoutPolicy::max_cooldown  6*3600s
  ];
  got numeric;
begin
  insert into config.resilience default values on conflict do nothing;

  for i in 1 .. array_length(expected, 1) loop
    execute format('select %I::numeric from config.resilience', expected[i][1]) into got;
    if got is null then
      raise exception 'FAIL R1: config.resilience.% does not exist', expected[i][1]; end if;
    if got <> expected[i][2]::numeric then
      raise exception 'FAIL R1: % default = %, engine default is % — a drift here silently changes routing behaviour',
        expected[i][1], got, expected[i][2]; end if;
  end loop;
  raise notice 'PASSED R1: all 9 defaults match the engine exactly (a default row changes nothing)';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- R2 — singleton. One deployment, one resilience policy.
--
--      NB this is the same `id boolean` shape criticised in gateway's
--      orchestrator.config_versions — but there it was wrong because it made
--      TENANT data global (one tenant's publish killing another's runs). Here
--      the value genuinely IS process-global, so a second row could only ever
--      be an ambiguity about which one the engine loaded.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare n int; blocked boolean := false;
begin
  begin
    insert into config.resilience (id) values (false);
  exception when check_violation or unique_violation then blocked := true;
  end;
  select count(*) into n from config.resilience;
  if not blocked then raise exception 'FAIL R2: a second resilience row was accepted'; end if;
  if n <> 1 then raise exception 'FAIL R2: % rows present, expected exactly 1', n; end if;
  raise notice 'PASSED R2: exactly one row is representable';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- R3 — min_samples may not be 0. Straight from the engine's own hazard note:
--      an endpoint with live samples but a zero counter reports mean 0.0, which
--      a metric sort reads as a MEASUREMENT — so "the endpoint wins every race
--      it has never run". Any value >= 1 makes that unreachable.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare blocked boolean := false;
begin
  begin
    update config.resilience set min_samples = 0;
  exception when check_violation then blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL R3: min_samples = 0 was accepted — a never-run endpoint would win every race'; end if;
  if (select min_samples from config.resilience) <> 3 then
    raise exception 'FAIL R3: min_samples changed despite the rejected update'; end if;
  raise notice 'PASSED R3: min_samples = 0 is rejected (engine hazard: mean 0.0 read as measured)';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- R4 — jitter_fraction is a FRACTION in [0.0, 1.0). 1.0 or more would double a
--      deadline rather than spread it; negative would pull it into the past and
--      expire a cooldown that never ran.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare hi boolean := false; lo boolean := false;
begin
  begin update config.resilience set jitter_fraction = 1.0;
  exception when check_violation then hi := true; end;
  begin update config.resilience set jitter_fraction = -0.1;
  exception when check_violation then lo := true; end;
  if not hi then raise exception 'FAIL R4: jitter_fraction = 1.0 was accepted'; end if;
  if not lo then raise exception 'FAIL R4: a negative jitter_fraction was accepted'; end if;
  raise notice 'PASSED R4: jitter_fraction is constrained to [0.0, 1.0)';
end $$;

\echo '== resilience config tests complete =='
