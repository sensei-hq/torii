-- G4 — durable health-gate state: connection cooldown, model lockout.
--
-- WHY THIS EXISTS: the engine's three health gates (circuit breaker, connection cooldown,
-- model lockout) keep their state IN PROCESS. torii-gateway runs on Fly with
-- `min_machines_running = 0` and `auto_stop_machines = 'suspend'`, so that state EVAPORATES
-- whenever the app idles — a model locked out at 14:00 is un-locked-out after a suspend — and
-- once a second machine starts past the concurrency soft limit, the two disagree about which
-- providers are healthy. This gives the state a durable, tenant-scoped home.
--
-- THE TRAP THIS PINS: a lock is TERMINAL when it needs a human (credits exhausted, bad
-- credential); the engine models that as `until: None`. Stored naively, terminal locks have a
-- NULL deadline — and the obvious query, `where locked_until > now()`, silently MISSES every
-- one of them. That is fail-OPEN on exactly the locks that matter most: the gateway would keep
-- routing to an endpoint whose key is dead. H4 pins that the active-lock view includes them.
\set ON_ERROR_STOP on
\echo '== health gates: durable cooldown + model lockout =='

-- ─────────────────────────────────────────────────────────────────────────
-- H1 — the lock-reason enum mirrors the engine's LockReason, in its order.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare vals text;
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'catalog' and t.typname = 'lock_reason' and t.typtype = 'e')
  then raise exception 'FAIL H1: enum catalog.lock_reason does not exist'; end if;

  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into vals
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'catalog' and t.typname = 'lock_reason';
  if vals is distinct from 'rate_limit,quota_exhausted,credits_exhausted,auth' then
    raise exception 'FAIL H1: lock_reason = %, expected rate_limit,quota_exhausted,credits_exhausted,auth', vals; end if;
  raise notice 'PASSED H1: catalog.lock_reason mirrors the engine''s LockReason';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- H2 — the tables carry the engine's state: per-endpoint lockout (reason,
--      deadline, escalation memory) and router-level connection cooldown.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'catalog' and table_name = 'endpoint_lockouts'
     and column_name in ('tenant_id','router_id','model_id','reason','locked_until','escalation');
  if n <> 6 then raise exception 'FAIL H2: catalog.endpoint_lockouts has % of 6 expected columns', n; end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='catalog' and table_name='provider_health'
                    and column_name='cooling_until')
  then raise exception 'FAIL H2: catalog.provider_health.cooling_until does not exist'; end if;
  raise notice 'PASSED H2: endpoint_lockouts + provider_health.cooling_until';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- H3–H5 — the invariant, the fail-open trap, and expiry-vs-memory.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  tid uuid; rid uuid; m1 uuid; m2 uuid; m3 uuid; pid uuid;
  bad_recoverable boolean := false; bad_terminal boolean := false;
  naive int; correct int; esc int;
begin
  select id into tid from core.tenants where is_platform limit 1;
  select id into rid from catalog.routers limit 1;
  select id into pid from catalog.providers limit 1;
  if tid is null or rid is null or pid is null then
    raise notice 'SKIPPED H3-H5: no platform tenant / router / provider seeded'; return; end if;

  insert into catalog.models (provider_id, name, version, full_name)
    values (pid,'g4-m1','v1','g4-m1-v1') returning id into m1;
  insert into catalog.models (provider_id, name, version, full_name)
    values (pid,'g4-m2','v1','g4-m2-v1') returning id into m2;
  insert into catalog.models (provider_id, name, version, full_name)
    values (pid,'g4-m3','v1','g4-m3-v1') returning id into m3;

  -- H3 — terminality is structural, not a convention. A recoverable reason MUST carry a
  --      deadline (it comes back); a terminal one MUST NOT (only a human clears it).
  begin
    insert into catalog.endpoint_lockouts (tenant_id, router_id, model_id, reason, locked_until)
      values (tid, rid, m1, 'rate_limit', null);
  exception when check_violation then bad_recoverable := true;
  end;
  begin
    insert into catalog.endpoint_lockouts (tenant_id, router_id, model_id, reason, locked_until)
      values (tid, rid, m1, 'auth', now() + interval '1 hour');
  exception when check_violation then bad_terminal := true;
  end;
  if not bad_recoverable then
    raise exception 'FAIL H3: a recoverable lock with no deadline was accepted'; end if;
  if not bad_terminal then
    raise exception 'FAIL H3: a terminal lock with a deadline was accepted'; end if;
  raise notice 'PASSED H3: recoverable locks require a deadline; terminal locks forbid one';

  -- Three endpoints: an ACTIVE recoverable lock, a TERMINAL lock, an EXPIRED recoverable one.
  insert into catalog.endpoint_lockouts (tenant_id, router_id, model_id, reason, locked_until, escalation)
  values
    (tid, rid, m1, 'rate_limit',        now() + interval '10 minutes', 0),
    (tid, rid, m2, 'credits_exhausted', null,                          0),
    (tid, rid, m3, 'quota_exhausted',   now() - interval '10 minutes', 3);

  -- H4 — THE FAIL-OPEN TRAP. The naive deadline test sees only the first; the terminal lock
  --      (NULL deadline) vanishes, and the gateway would keep routing to a dead credential.
  select count(*) into naive from catalog.endpoint_lockouts
   where tenant_id = tid and model_id in (m1,m2,m3) and locked_until > now();
  select count(*) into correct from catalog.endpoint_lockout_active
   where tenant_id = tid and model_id in (m1,m2,m3);

  if naive <> 1 then
    raise exception 'FAIL H4: fixture wrong — naive deadline query matched %, expected 1', naive; end if;
  if correct <> 2 then
    raise exception 'FAIL H4: active view returned % locks, expected 2 (the timed one AND the terminal one)', correct; end if;
  if not exists (select 1 from catalog.endpoint_lockout_active
                  where tenant_id = tid and model_id = m2 and is_terminal) then
    raise exception 'FAIL H4: the terminal lock is missing from the active view — fail-OPEN on a dead credential'; end if;
  raise notice 'PASSED H4: the active view includes terminal locks the naive deadline query drops';

  -- H5 — an expired recoverable lock is NOT active, but its escalation memory survives: the
  --      engine retains the entry past expiry so a repeat offender is locked out for longer.
  if exists (select 1 from catalog.endpoint_lockout_active
              where tenant_id = tid and model_id = m3) then
    raise exception 'FAIL H5: an expired recoverable lock is still reported active'; end if;
  select escalation into esc from catalog.endpoint_lockouts
   where tenant_id = tid and model_id = m3;
  if esc is distinct from 3 then
    raise exception 'FAIL H5: escalation memory = %, expected 3 to survive expiry', esc; end if;
  raise notice 'PASSED H5: expiry clears the lock but keeps escalation memory';

  delete from catalog.endpoint_lockouts where tenant_id = tid and model_id in (m1,m2,m3);
  delete from catalog.models where name like 'g4-m%';
end $$;

\echo '== health gate tests complete =='
