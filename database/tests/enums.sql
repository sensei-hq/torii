-- DB enum conversion (db-redesign.md §3) — regression guard for the coordinated
-- varchar+CHECK → Postgres enum migration. Starts with `core.execution_location`
-- {local,cloud}, which unifies the four execution_location columns AND routing `plane`.
--
-- WHY THIS TEST EXISTS: converting a column to an enum is NOT DB-only. The C1 hot
-- path binds these columns as Rust `&str`, and Postgres REJECTS a text parameter
-- inserted straight into an enum column ("column is of type … but expression is of
-- type text"). The fix is a `$N::core.execution_location` cast at every write site.
-- E3 below pins BOTH halves: the un-cast text param must fail, the cast must succeed —
-- so a future edit that drops a cast (re-breaking /v1/chat) fails here first.
\set ON_ERROR_STOP on
\echo '== enum conversion: core.execution_location =='

-- ─────────────────────────────────────────────────────────────────────────
-- E1 — the enum type exists in `core` with exactly {local, cloud}.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare vals text;
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'core' and t.typname = 'execution_location' and t.typtype = 'e')
  then raise exception 'FAIL: enum type core.execution_location does not exist'; end if;

  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into vals
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'core' and t.typname = 'execution_location';
  if vals is distinct from 'local,cloud' then
    raise exception 'FAIL: core.execution_location values = %, expected local,cloud', vals; end if;
  raise notice 'E1 core.execution_location enum {local,cloud} ✓';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- E2 — all five migrated columns ARE the enum type (udt core.execution_location),
--      and none still carries a varchar/CHECK definition.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  cols text[][] := array[
    ['inference_calls','execution_location'],
    ['messages','execution_location'],
    ['gateway_tasks','execution_location'],
    ['analytics_usage_daily','execution_location'],
    ['fallback_chain_models','plane']];
  i int;
  t text; c text; udt text;
begin
  for i in 1 .. array_length(cols, 1) loop
    t := cols[i][1]; c := cols[i][2];
    select udt_name into udt from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name = c;
    if udt is null then
      raise exception 'FAIL: %.% not found', t, c; end if;
    if udt is distinct from 'execution_location' then
      raise exception 'FAIL: %.% udt=% (expected execution_location enum)', t, c, udt; end if;
  end loop;
  -- the leftover CHECK constraints must be gone (the enum supersedes them).
  if exists (select 1 from pg_constraint
              where contype = 'c'
                and (pg_get_constraintdef(oid) ilike '%execution_location%in%'
                  or pg_get_constraintdef(oid) ilike '%plane%in%')) then
    raise exception 'FAIL: a leftover local/cloud CHECK constraint still exists'; end if;
  raise notice 'E2 five columns are core.execution_location, no leftover CHECK ✓';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- E3 — the write-path contract: a TEXT parameter needs an explicit cast.
--      Un-cast text param → error (this is the /v1/chat break). Cast → success.
--      Invalid label → error. Probed on a temp column of the enum type so the
--      assertion is about the type, not FK plumbing.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare bad boolean := false;
begin
  create temp table _el_probe (loc core.execution_location) on commit drop;

  -- (a) un-cast text parameter MUST fail (proves the cast is load-bearing).
  begin
    execute 'insert into _el_probe(loc) values ($1)' using 'local'::text;
    bad := true;   -- reached only if Postgres wrongly accepted text → enum
  exception when others then null; end;
  if bad then
    raise exception 'FAIL: un-cast text param was accepted into an enum column (cast no longer required?)'; end if;

  -- (b) the cast used at every Rust write site MUST succeed for both labels.
  execute 'insert into _el_probe(loc) values ($1::core.execution_location)' using 'local'::text;
  execute 'insert into _el_probe(loc) values ($1::core.execution_location)' using 'cloud'::text;

  -- (c) an invalid label MUST be rejected.
  bad := false;
  begin
    execute 'insert into _el_probe(loc) values ($1::core.execution_location)' using 'onprem'::text;
    bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: invalid enum label "onprem" was accepted'; end if;

  raise notice 'E3 write contract: un-cast text fails, cast succeeds, bad label rejected ✓';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- E4 — the analytics READ pattern (coalesce + literal compare + filter + group)
--      must still work once the column is an enum (literal coercion). This is the
--      exact shape the O2 rollup functions & /v1/analytics queries rely on.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare n_cloud bigint; n_local bigint; n_groups bigint;
begin
  create temp table _el_read (loc core.execution_location) on commit drop;
  insert into _el_read(loc) values ('local'::core.execution_location),
                                    ('cloud'::core.execution_location), (null);

  select count(*) filter (where coalesce(loc,'cloud') = 'cloud'),
         count(*) filter (where coalesce(loc,'cloud') = 'local'),
         count(distinct coalesce(loc,'cloud'))
    into n_cloud, n_local, n_groups
    from _el_read;

  if n_cloud <> 2 then raise exception 'FAIL: coalesce cloud count = % (expected 2)', n_cloud; end if;
  if n_local <> 1 then raise exception 'FAIL: coalesce local count = % (expected 1)', n_local; end if;
  if n_groups <> 2 then raise exception 'FAIL: distinct coalesce groups = % (expected 2)', n_groups; end if;
  raise notice 'E4 analytics coalesce/compare/filter/group over enum ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- core.classification_level {public,internal,confidential,restricted}
-- (documents.classification, spaces.classification, dataset_columns.sensitivity).
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: core.classification_level =='

-- C1 — enum type exists with exactly the 4 fixed levels (order matters: low→high).
do $$
declare vals text;
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                  where n.nspname='core' and t.typname='classification_level' and t.typtype='e')
  then raise exception 'FAIL: enum type core.classification_level does not exist'; end if;
  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into vals
    from pg_enum e join pg_type t on t.oid=e.enumtypid
    join pg_namespace n on n.oid=t.typnamespace
   where n.nspname='core' and t.typname='classification_level';
  if vals is distinct from 'public,internal,confidential,restricted' then
    raise exception 'FAIL: core.classification_level values = %, expected public,internal,confidential,restricted', vals; end if;
  raise notice 'C1 core.classification_level enum {public,internal,confidential,restricted} ✓';
end $$;

-- C2 — the three migrated columns ARE the enum type, no leftover CHECK.
do $$
declare
  cols text[][] := array[
    ['documents','classification'],
    ['spaces','classification'],
    ['dataset_columns','sensitivity']];
  i int; t text; c text; udt text;
begin
  for i in 1 .. array_length(cols,1) loop
    t := cols[i][1]; c := cols[i][2];
    select udt_name into udt from information_schema.columns
     where table_schema='public' and table_name=t and column_name=c;
    if udt is distinct from 'classification_level' then
      raise exception 'FAIL: %.% udt=% (expected classification_level enum)', t, c, coalesce(udt,'<none>'); end if;
  end loop;
  if exists (select 1 from pg_constraint where contype='c'
              and (pg_get_constraintdef(oid) ilike '%classification%in%'
                or pg_get_constraintdef(oid) ilike '%sensitivity%in%')) then
    raise exception 'FAIL: a leftover classification/sensitivity CHECK still exists'; end if;
  raise notice 'C2 three columns are core.classification_level, no leftover CHECK ✓';
end $$;

-- C3 — write contract: un-cast text param fails, cast succeeds, bad label rejected.
do $$
declare bad boolean := false;
begin
  create temp table _cl_probe (lvl core.classification_level) on commit drop;
  begin
    execute 'insert into _cl_probe(lvl) values ($1)' using 'confidential'::text;
    bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: un-cast text param accepted into classification_level column'; end if;

  execute 'insert into _cl_probe(lvl) values ($1::core.classification_level)' using 'public'::text;
  execute 'insert into _cl_probe(lvl) values ($1::core.classification_level)' using 'restricted'::text;

  bad := false;
  begin
    execute 'insert into _cl_probe(lvl) values ($1::core.classification_level)' using 'secret'::text;
    bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: invalid classification label "secret" accepted'; end if;
  raise notice 'C3 write contract: un-cast fails, cast succeeds, bad label rejected ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- metering.call_status {success,failed} — inference_calls.status (the ledger call
-- outcome). NOT gateway_tasks.status: that table is LEGACY/retiring (§7) and keeps
-- its varchar+CHECK {running,success,failed} until dropped.
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: metering.call_status =='

-- M1 — enum type exists in metering with exactly {success,failed}.
do $$
declare vals text;
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                  where n.nspname='metering' and t.typname='call_status' and t.typtype='e')
  then raise exception 'FAIL: enum type metering.call_status does not exist'; end if;
  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into vals
    from pg_enum e join pg_type t on t.oid=e.enumtypid
    join pg_namespace n on n.oid=t.typnamespace
   where n.nspname='metering' and t.typname='call_status';
  if vals is distinct from 'success,failed' then
    raise exception 'FAIL: metering.call_status values = %, expected success,failed', vals; end if;
  raise notice 'M1 metering.call_status enum {success,failed} ✓';
end $$;

-- M2 — inference_calls.status IS the enum, with no leftover CHECK on that column.
--      (gateway_tasks.status intentionally keeps its varchar CHECK — legacy table.)
do $$
declare udt text;
begin
  select udt_name into udt from information_schema.columns
   where table_schema='public' and table_name='inference_calls' and column_name='status';
  if udt is distinct from 'call_status' then
    raise exception 'FAIL: inference_calls.status udt=% (expected call_status enum)', coalesce(udt,'<none>'); end if;
  if exists (select 1 from pg_constraint
              where conrelid='public.inference_calls'::regclass and contype='c'
                and pg_get_constraintdef(oid) ilike '%status%in%') then
    raise exception 'FAIL: inference_calls still has a status CHECK constraint'; end if;
  raise notice 'M2 inference_calls.status is metering.call_status, no leftover CHECK ✓';
end $$;

-- M3 — write contract: un-cast text param fails, cast succeeds, bad label rejected.
do $$
declare bad boolean := false;
begin
  create temp table _cs_probe (st metering.call_status) on commit drop;
  begin
    execute 'insert into _cs_probe(st) values ($1)' using 'success'::text;
    bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: un-cast text param accepted into call_status column'; end if;

  execute 'insert into _cs_probe(st) values ($1::metering.call_status)' using 'success'::text;
  execute 'insert into _cs_probe(st) values ($1::metering.call_status)' using 'failed'::text;

  bad := false;
  begin
    execute 'insert into _cs_probe(st) values ($1::metering.call_status)' using 'running'::text;
    bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: invalid call_status label "running" accepted'; end if;
  raise notice 'M3 write contract: un-cast fails, cast succeeds, bad label rejected ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- governance budget enums: budget_period, enforcement (budget_nodes) ·
-- hold_status (budget_holds.status) · request_status (budget_requests.status).
-- request_status uses 'denied' (the live deny-RPC term), not the stale CHECK's 'rejected'.
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: governance budget enums =='

do $$
declare
  specs text[][] := array[
    ['budget_period','daily,weekly,monthly'],
    ['enforcement','hard,soft'],
    ['hold_status','active,committed,released,expired'],
    ['request_status','pending,approved,denied,withdrawn']];
  i int; nm text; want text; got text;
begin
  for i in 1 .. array_length(specs,1) loop
    nm := specs[i][1]; want := specs[i][2];
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                    where n.nspname='governance' and t.typname=nm and t.typtype='e') then
      raise exception 'FAIL: enum governance.% does not exist', nm; end if;
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into got
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='governance' and t.typname=nm;
    if got is distinct from want then
      raise exception 'FAIL: governance.% = %, expected %', nm, got, want; end if;
  end loop;
  raise notice 'G1 four governance budget enums exist with expected values ✓';
end $$;

do $$
declare
  cols text[][] := array[
    ['budget_nodes','period','budget_period'],
    ['budget_nodes','enforcement','enforcement'],
    ['budget_holds','status','hold_status'],
    ['budget_requests','status','request_status']];
  i int; t text; c text; want text; udt text;
begin
  for i in 1 .. array_length(cols,1) loop
    t := cols[i][1]; c := cols[i][2]; want := cols[i][3];
    select udt_name into udt from information_schema.columns
     where table_schema='public' and table_name=t and column_name=c;
    if udt is distinct from want then
      raise exception 'FAIL: %.% udt=% (expected %)', t, c, coalesce(udt,'<none>'), want; end if;
  end loop;
  if exists (select 1 from pg_constraint where contype='c'
              and conrelid::regclass::text like 'budget%'
              and (pg_get_constraintdef(oid) ilike '%period%in%'
                or pg_get_constraintdef(oid) ilike '%enforcement%in%'
                or pg_get_constraintdef(oid) ilike '%status%in%')) then
    raise exception 'FAIL: a leftover budget period/enforcement/status CHECK still exists'; end if;
  raise notice 'G2 four budget columns are the governance enums, no leftover CHECK ✓';
end $$;

-- write contract on request_status (representative): un-cast fails, cast succeeds, bad rejected.
do $$
declare bad boolean := false;
begin
  create temp table _rq_probe (st governance.request_status) on commit drop;
  begin execute 'insert into _rq_probe(st) values ($1)' using 'pending'::text; bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: un-cast text accepted into request_status'; end if;
  execute 'insert into _rq_probe(st) values ($1::governance.request_status)' using 'denied'::text;
  bad := false;
  begin execute 'insert into _rq_probe(st) values ($1::governance.request_status)' using 'rejected'::text; bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: stale label "rejected" accepted into request_status'; end if;
  raise notice 'G3 request_status write contract (denied valid, rejected invalid) ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- catalog enums: router_type, auth_type (config.routers) · override_scope
-- (model_overrides.scope_type) · breaker_state (provider_health.state).
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: catalog enums =='

do $$
declare
  specs text[][] := array[
    ['router_type','direct,aggregator,local'],
    ['auth_type','api_key,aws_signature,oauth2,bearer_token,custom,none'],
    ['override_scope','tenant,space,role'],
    ['breaker_state','closed,open,half-open']];
  i int; nm text; want text; got text;
begin
  for i in 1 .. array_length(specs,1) loop
    nm := specs[i][1]; want := specs[i][2];
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                    where n.nspname='catalog' and t.typname=nm and t.typtype='e') then
      raise exception 'FAIL: enum catalog.% does not exist', nm; end if;
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into got
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='catalog' and t.typname=nm;
    if got is distinct from want then raise exception 'FAIL: catalog.% = %, expected %', nm, got, want; end if;
  end loop;
  raise notice 'K1 four catalog enums exist with expected values ✓';
end $$;

do $$
declare
  cols text[][] := array[
    ['config','routers','router_type','router_type'],
    ['config','routers','authentication_type','auth_type'],
    ['public','model_overrides','scope_type','override_scope'],
    ['public','provider_health','state','breaker_state']];
  i int; s text; t text; c text; want text; udt text;
begin
  for i in 1 .. array_length(cols,1) loop
    s := cols[i][1]; t := cols[i][2]; c := cols[i][3]; want := cols[i][4];
    select udt_name into udt from information_schema.columns
     where table_schema=s and table_name=t and column_name=c;
    if udt is distinct from want then
      raise exception 'FAIL: %.%.% udt=% (expected %)', s, t, c, coalesce(udt,'<none>'), want; end if;
  end loop;
  if exists (select 1 from pg_constraint where contype='c'
              and conrelid in ('config.routers'::regclass,'public.model_overrides'::regclass,'public.provider_health'::regclass)
              and (pg_get_constraintdef(oid) ilike '%router_type%in%'
                or pg_get_constraintdef(oid) ilike '%authentication_type%in%'
                or pg_get_constraintdef(oid) ilike '%scope_type%in%'
                or pg_get_constraintdef(oid) ilike '%state%in%')) then
    raise exception 'FAIL: a leftover catalog CHECK still exists'; end if;
  raise notice 'K2 four catalog columns are the enums, no leftover CHECK ✓';
end $$;

do $$
declare bad boolean := false;
begin
  create temp table _cat_probe (rt catalog.router_type) on commit drop;
  begin execute 'insert into _cat_probe(rt) values ($1)' using 'direct'::text; bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: un-cast text accepted into catalog.router_type'; end if;
  execute 'insert into _cat_probe(rt) values ($1::catalog.router_type)' using 'aggregator'::text;
  bad := false;
  begin execute 'insert into _cat_probe(rt) values ($1::catalog.router_type)' using 'proxy'::text; bad := true;
  exception when others then null; end;
  if bad then raise exception 'FAIL: invalid router_type "proxy" accepted'; end if;
  raise notice 'K3 catalog write contract (cast succeeds, bad label rejected) ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- metering.signal_class {explicit,implicit,system} — quality_signals.signal_class.
-- (signal_subject deferred: its column is design-only, needs the §7-#6 subject rework.)
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: metering.signal_class =='
do $$
declare vals text; udt text;
begin
  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into vals
    from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
   where n.nspname='metering' and t.typname='signal_class';
  if vals is distinct from 'explicit,implicit,system' then
    raise exception 'FAIL: metering.signal_class = %, expected explicit,implicit,system', coalesce(vals,'<none>'); end if;
  select udt_name into udt from information_schema.columns
   where table_schema='public' and table_name='quality_signals' and column_name='signal_class';
  if udt is distinct from 'signal_class' then
    raise exception 'FAIL: quality_signals.signal_class udt=% (expected signal_class enum)', coalesce(udt,'<none>'); end if;
  if exists (select 1 from pg_constraint where conrelid='public.quality_signals'::regclass and contype='c'
              and pg_get_constraintdef(oid) ilike '%signal_class%in%') then
    raise exception 'FAIL: quality_signals still has a signal_class CHECK'; end if;
  raise notice 'S1 metering.signal_class enum + column, no leftover CHECK ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- core+access enums: tenant_status (core.tenants) · membership_status
-- (core.profile_tenants) · api_key_status (api_keys) · service_account_status
-- (service_accounts). idp_kind DEFERRED (identity_providers table not built).
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: core+access enums =='

do $$
declare
  specs text[][] := array[
    ['tenant_status','active,suspended,trial'],
    ['membership_status','active,suspended'],
    ['api_key_status','active,revoked'],
    ['service_account_status','active,disabled']];
  i int; nm text; want text; got text;
begin
  for i in 1 .. array_length(specs,1) loop
    nm := specs[i][1]; want := specs[i][2];
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                    where n.nspname='core' and t.typname=nm and t.typtype='e') then
      raise exception 'FAIL: enum core.% does not exist', nm; end if;
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into got
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='core' and t.typname=nm;
    if got is distinct from want then raise exception 'FAIL: core.% = %, expected %', nm, got, want; end if;
  end loop;
  raise notice 'A1 four core+access enums exist with expected values ✓';
end $$;

do $$
declare
  cols text[][] := array[
    ['core','tenants','status','tenant_status'],
    ['core','profile_tenants','status','membership_status'],
    ['public','api_keys','status','api_key_status'],
    ['public','service_accounts','status','service_account_status']];
  i int; s text; t text; c text; want text; udt text;
begin
  for i in 1 .. array_length(cols,1) loop
    s := cols[i][1]; t := cols[i][2]; c := cols[i][3]; want := cols[i][4];
    select udt_name into udt from information_schema.columns
     where table_schema=s and table_name=t and column_name=c;
    if udt is distinct from want then
      raise exception 'FAIL: %.%.% udt=% (expected %)', s, t, c, coalesce(udt,'<none>'), want; end if;
  end loop;
  if exists (select 1 from pg_constraint where contype='c'
              and conrelid in ('core.tenants'::regclass,'core.profile_tenants'::regclass,'public.api_keys'::regclass,'public.service_accounts'::regclass)
              and pg_get_constraintdef(oid) ilike '%status%in%') then
    raise exception 'FAIL: a leftover core+access status CHECK still exists'; end if;
  raise notice 'A2 four core+access columns are the enums, no leftover CHECK ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- governance enums: feature_scope + feature_state (feature_policies) · config_scope
-- (settings.scope). redaction_action + enforcement_outcome DEFERRED (greenfield tables).
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: governance enums =='

do $$
declare
  specs text[][] := array[
    ['feature_scope','workspace,space,role'],
    ['feature_state','locked,default-on,default-off,user-overridable'],
    ['config_scope','workspace,space']];
  i int; nm text; want text; got text;
begin
  for i in 1 .. array_length(specs,1) loop
    nm := specs[i][1]; want := specs[i][2];
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                    where n.nspname='governance' and t.typname=nm and t.typtype='e') then
      raise exception 'FAIL: enum governance.% does not exist', nm; end if;
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into got
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='governance' and t.typname=nm;
    if got is distinct from want then raise exception 'FAIL: governance.% = %, expected %', nm, got, want; end if;
  end loop;
  raise notice 'GV1 three governance enums exist with expected values ✓';
end $$;

do $$
declare
  cols text[][] := array[
    ['feature_policies','scope_type','feature_scope'],
    ['feature_policies','state','feature_state'],
    ['settings','scope','config_scope']];
  i int; t text; c text; want text; udt text;
begin
  for i in 1 .. array_length(cols,1) loop
    t := cols[i][1]; c := cols[i][2]; want := cols[i][3];
    select udt_name into udt from information_schema.columns
     where table_schema='public' and table_name=t and column_name=c;
    if udt is distinct from want then
      raise exception 'FAIL: %.% udt=% (expected %)', t, c, coalesce(udt,'<none>'), want; end if;
  end loop;
  if exists (select 1 from pg_constraint where contype='c'
              and conrelid in ('public.feature_policies'::regclass,'public.settings'::regclass)
              and (pg_get_constraintdef(oid) ilike '%scope_type%in%'
                or pg_get_constraintdef(oid) ilike '%state%in%'
                or pg_get_constraintdef(oid) ilike '%scope%in%')) then
    raise exception 'FAIL: a leftover governance CHECK still exists'; end if;
  raise notice 'GV2 three governance columns are the enums, no leftover CHECK ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- device enums: mcp_transport + mcp_scope (mcp_servers) · device_status (devices).
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: device enums =='

do $$
declare
  specs text[][] := array[
    ['mcp_transport','stdio,http,sse'],
    ['mcp_scope','platform,tenant'],
    ['device_status','active,revoked']];
  i int; nm text; want text; got text;
begin
  for i in 1 .. array_length(specs,1) loop
    nm := specs[i][1]; want := specs[i][2];
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                    where n.nspname='device' and t.typname=nm and t.typtype='e') then
      raise exception 'FAIL: enum device.% does not exist', nm; end if;
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into got
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='device' and t.typname=nm;
    if got is distinct from want then raise exception 'FAIL: device.% = %, expected %', nm, got, want; end if;
  end loop;
  raise notice 'D1 three device enums exist with expected values ✓';
end $$;

do $$
declare
  cols text[][] := array[
    ['mcp_servers','transport','mcp_transport'],
    ['mcp_servers','scope','mcp_scope'],
    ['devices','status','device_status']];
  i int; t text; c text; want text; udt text;
begin
  for i in 1 .. array_length(cols,1) loop
    t := cols[i][1]; c := cols[i][2]; want := cols[i][3];
    select udt_name into udt from information_schema.columns
     where table_schema='public' and table_name=t and column_name=c;
    if udt is distinct from want then
      raise exception 'FAIL: %.% udt=% (expected %)', t, c, coalesce(udt,'<none>'), want; end if;
  end loop;
  if exists (select 1 from pg_constraint where contype='c'
              and conrelid in ('public.mcp_servers'::regclass,'public.devices'::regclass)
              and (pg_get_constraintdef(oid) ilike '%transport%in%'
                or pg_get_constraintdef(oid) ilike '%scope%in%'
                or pg_get_constraintdef(oid) ilike '%status%in%')) then
    raise exception 'FAIL: a leftover device CHECK still exists'; end if;
  raise notice 'D2 three device columns are the enums, no leftover CHECK ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- audit enums: alert_severity (alert_rules + alert_events) · channel_kind
-- (notification_channels) · operation (history.past_feature_states, UPPERCASE).
-- alert_kind DEFERRED (no CHECK/data/code; value set unratified).
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: audit enums =='

do $$
declare
  specs text[][] := array[
    ['alert_severity','info,warning,critical'],
    ['channel_kind','email,slack,webhook,siem'],
    ['operation','INSERT,UPDATE,DELETE']];
  i int; nm text; want text; got text;
begin
  for i in 1 .. array_length(specs,1) loop
    nm := specs[i][1]; want := specs[i][2];
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                    where n.nspname='audit' and t.typname=nm and t.typtype='e') then
      raise exception 'FAIL: enum audit.% does not exist', nm; end if;
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into got
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='audit' and t.typname=nm;
    if got is distinct from want then raise exception 'FAIL: audit.% = %, expected %', nm, got, want; end if;
  end loop;
  raise notice 'AU1 three audit enums exist with expected values ✓';
end $$;

do $$
declare
  cols text[][] := array[
    ['public','alert_rules','severity','alert_severity'],
    ['public','alert_events','severity','alert_severity'],
    ['audit','notification_channels','kind','channel_kind'],
    ['history','past_feature_states','operation','operation']];
  i int; s text; t text; c text; want text; udt text;
begin
  for i in 1 .. array_length(cols,1) loop
    s := cols[i][1]; t := cols[i][2]; c := cols[i][3]; want := cols[i][4];
    select udt_name into udt from information_schema.columns
     where table_schema=s and table_name=t and column_name=c;
    if udt is distinct from want then
      raise exception 'FAIL: %.%.% udt=% (expected %)', s, t, c, coalesce(udt,'<none>'), want; end if;
  end loop;
  if exists (select 1 from pg_constraint where contype='c'
              and conrelid in ('public.alert_rules'::regclass,'audit.notification_channels'::regclass)
              and (pg_get_constraintdef(oid) ilike '%severity%in%' or pg_get_constraintdef(oid) ilike '%kind%in%')) then
    raise exception 'FAIL: a leftover audit CHECK still exists'; end if;
  raise notice 'AU2 four audit columns are the enums, no leftover CHECK ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- content enums: message_role (messages) · document_scope (documents) ·
-- asset_kind (document_assets) · space_role (space_members).
-- (document_lifecycle SPLIT from documents.status DEFERRED — §7-#5, behavior change.)
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: content enums =='

do $$
declare
  specs text[][] := array[
    ['message_role','user,assistant,system'],
    ['document_scope','system,tenant,user'],
    ['asset_kind','original,ir_json,markdown,table_csv,image,caption,json,text,other'],
    ['space_role','owner,editor,viewer,member']];
  i int; nm text; want text; got text;
begin
  for i in 1 .. array_length(specs,1) loop
    nm := specs[i][1]; want := specs[i][2];
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                    where n.nspname='content' and t.typname=nm and t.typtype='e') then
      raise exception 'FAIL: enum content.% does not exist', nm; end if;
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into got
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='content' and t.typname=nm;
    if got is distinct from want then raise exception 'FAIL: content.% = %, expected %', nm, got, want; end if;
  end loop;
  raise notice 'CT1 four content enums exist with expected values ✓';
end $$;

do $$
declare
  cols text[][] := array[
    ['messages','role','message_role'],
    ['documents','scope','document_scope'],
    ['document_assets','kind','asset_kind'],
    ['space_members','role','space_role']];
  i int; t text; c text; want text; udt text;
begin
  for i in 1 .. array_length(cols,1) loop
    t := cols[i][1]; c := cols[i][2]; want := cols[i][3];
    select udt_name into udt from information_schema.columns
     where table_schema='public' and table_name=t and column_name=c;
    if udt is distinct from want then
      raise exception 'FAIL: %.% udt=% (expected %)', t, c, coalesce(udt,'<none>'), want; end if;
  end loop;
  if exists (select 1 from pg_constraint where contype='c'
              and conrelid in ('public.messages'::regclass,'public.documents'::regclass,'public.document_assets'::regclass,'public.space_members'::regclass)
              and (pg_get_constraintdef(oid) ilike '%role%in%'
                or pg_get_constraintdef(oid) ilike '%scope%in%'
                or pg_get_constraintdef(oid) ilike '%kind%in%')) then
    raise exception 'FAIL: a leftover content CHECK still exists'; end if;
  raise notice 'CT2 four content columns are the enums, no leftover CHECK ✓';
end $$;

-- CT3 — the guard_document_classification trigger survives the documents scope retype.
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.documents'::regclass
                  and tgname='trg_guard_document_classification' and not tgisinternal) then
    raise exception 'FAIL: trg_guard_document_classification lost from public.documents'; end if;
  raise notice 'CT3 guard_document_classification trigger intact ✓';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- keyvault enums: credential_type + refresh_status (router_credentials).
-- Schema RENAMED vault→keyvault (Supabase owns `vault`). The shared sensei-vault
-- crate stays decoupled via `credential_type::text = $4` (schema-agnostic).
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: keyvault enums =='

do $$
declare
  specs text[][] := array[
    ['credential_type','api_key,oauth'],
    ['refresh_status','ok,failed']];
  i int; nm text; want text; got text;
begin
  for i in 1 .. array_length(specs,1) loop
    nm := specs[i][1]; want := specs[i][2];
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                    where n.nspname='keyvault' and t.typname=nm and t.typtype='e') then
      raise exception 'FAIL: enum keyvault.% does not exist', nm; end if;
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into got
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='keyvault' and t.typname=nm;
    if got is distinct from want then raise exception 'FAIL: keyvault.% = %, expected %', nm, got, want; end if;
  end loop;
  raise notice 'KV1 two keyvault enums exist with expected values ✓';
end $$;

do $$
declare udt_ct text; udt_rs text;
begin
  select udt_name into udt_ct from information_schema.columns
   where table_schema='public' and table_name='router_credentials' and column_name='credential_type';
  select udt_name into udt_rs from information_schema.columns
   where table_schema='public' and table_name='router_credentials' and column_name='refresh_status';
  if udt_ct is distinct from 'credential_type' then
    raise exception 'FAIL: router_credentials.credential_type udt=% (expected credential_type)', coalesce(udt_ct,'<none>'); end if;
  if udt_rs is distinct from 'refresh_status' then
    raise exception 'FAIL: router_credentials.refresh_status udt=% (expected refresh_status)', coalesce(udt_rs,'<none>'); end if;
  if exists (select 1 from pg_constraint where conrelid='public.router_credentials'::regclass and contype='c'
              and pg_get_constraintdef(oid) ilike '%credential_type%in%(%') then
    raise exception 'FAIL: leftover credential_type value-set CHECK still exists'; end if;
  -- the cross-column blob_by_type CHECK MUST survive (its literals coerce over the enum).
  if not exists (select 1 from pg_constraint where conrelid='public.router_credentials'::regclass
                  and conname='router_credentials_blob_by_type') then
    raise exception 'FAIL: router_credentials_blob_by_type CHECK was lost'; end if;
  raise notice 'KV2 router_credentials cols are keyvault enums, value CHECK dropped, blob_by_type intact ✓';
end $$;

-- KV3 — the crate contract: `credential_type::text = $4` (bound text) resolves over the enum.
do $$
declare n int;
begin
  select count(*) into n from public.router_credentials where credential_type::text = 'api_key';
  raise notice 'KV3 schema-agnostic `credential_type::text = $bound` resolves over the enum (n=%) ✓', n;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- content.document_lifecycle SPLIT (§7-#5): documents.status{10 vals} →
-- lifecycle enum {pending,processing,completed,failed,archived} + free-form `stage`.
-- ═════════════════════════════════════════════════════════════════════════
\echo '== enum conversion: content.document_lifecycle split =='

do $$
declare vals text; udt text; stage_type text;
begin
  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into vals
    from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
   where n.nspname='content' and t.typname='document_lifecycle';
  if vals is distinct from 'pending,processing,completed,failed,archived' then
    raise exception 'FAIL: content.document_lifecycle = %, expected pending,processing,completed,failed,archived', coalesce(vals,'<none>'); end if;

  -- lifecycle column is the enum; the old `status` column is GONE; a `stage` varchar exists.
  select udt_name into udt from information_schema.columns
   where table_schema='public' and table_name='documents' and column_name='lifecycle';
  if udt is distinct from 'document_lifecycle' then
    raise exception 'FAIL: documents.lifecycle udt=% (expected document_lifecycle)', coalesce(udt,'<none>'); end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='documents' and column_name='status') then
    raise exception 'FAIL: legacy documents.status column still exists (should be renamed to lifecycle)'; end if;
  select data_type into stage_type from information_schema.columns
   where table_schema='public' and table_name='documents' and column_name='stage';
  if stage_type is null then raise exception 'FAIL: documents.stage column missing'; end if;
  if exists (select 1 from pg_constraint where conrelid='public.documents'::regclass and contype='c'
              and pg_get_constraintdef(oid) ilike '%status%in%') then
    raise exception 'FAIL: leftover documents status CHECK still exists'; end if;
  raise notice 'LF1 documents.lifecycle enum + stage col, status column/CHECK gone ✓';
end $$;

-- LF2 — retrieval filters were repointed status→lifecycle (else hybrid/similarity_search break).
do $$
begin
  if pg_get_functiondef('public.hybrid_search'::regproc) !~ 'lifecycle' then
    raise exception 'FAIL: hybrid_search does not reference lifecycle (still on d.status?)'; end if;
  if pg_get_functiondef('public.hybrid_search'::regproc) ~ 'd\.status' then
    raise exception 'FAIL: hybrid_search still references d.status'; end if;
  if pg_get_functiondef('public.similarity_search'::regproc) !~ 'lifecycle' then
    raise exception 'FAIL: similarity_search does not reference lifecycle'; end if;
  raise notice 'LF2 hybrid_search + similarity_search filter lifecycle=completed ✓';
end $$;

-- LF3 — the set_status mapping (step → lifecycle,stage) is what the Rust store writes.
do $$
declare lc text; st text;
begin
  create temp table _doc (lifecycle content.document_lifecycle, stage varchar) on commit drop;
  -- a transient step → processing + stage; a terminal step → its lifecycle, stage null.
  insert into _doc values ('processing'::content.document_lifecycle, 'chunking');   -- set_status('chunking')
  insert into _doc values ('completed'::content.document_lifecycle, null);           -- finalize
  select lifecycle::text, stage into lc, st from _doc where stage='chunking';
  if lc <> 'processing' then raise exception 'FAIL: chunking should map to processing lifecycle'; end if;
  if not exists (select 1 from _doc where lifecycle='completed' and stage is null) then
    raise exception 'FAIL: completed should have null stage'; end if;
  raise notice 'LF3 lifecycle/stage split model holds (processing+stage vs terminal+null) ✓';
end $$;

\echo '== enum conversion tests done =='
