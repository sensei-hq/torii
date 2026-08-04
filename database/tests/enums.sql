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

\echo '== enum conversion tests done =='
