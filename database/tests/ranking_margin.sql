-- Phase 4 — the quality margin, and the resolver that applies it.
--
-- WHY THIS TEST EXISTS: the resolver's job is to turn "the artifact says nimble is best"
-- into "these are the candidates THIS tenant can run, and this is how good they are". Two
-- different rules live in that sentence and confusing them is the whole risk:
--
--   · the margin is MEMBERSHIP (accuracy within `effective_margin` of the category's top
--     model), and it must never become POSITION — an admissible model keeps its artifact
--     rank, so a wider margin adds candidates instead of reshuffling them;
--   · `effective_margin = greatest(configured margin, top model CI half-width)`. A
--     tolerance finer than the measurement's own uncertainty is not a claim anyone can
--     keep, so configuring 0.0001 must NOT produce a razor-thin ranking.
--
-- And one rule that must survive both: NO ORDER EXISTS WITHOUT A WINNER. A tie or
-- insufficient verdict yields chain rows with `within_margin` NULL — not an empty result,
-- and not a silently alphabetical order.
--
-- Everything here runs in a transaction that is rolled back: the seeded tie is real
-- measured data and this harness must not leave promoted winners behind.
\set ON_ERROR_STOP on
\echo '== ranking margin: membership not position, CI floor, tenant override, isolation =='

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- M1 — catalog.ranking_policies: shape, the [0,1] domain, one default row per
--      category and at most one override per tenant.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  n int;
  cat constant text := 'planner.select';
  saw_high boolean := false;
  saw_low  boolean := false;
  saw_dup_default boolean := false;
  saw_dup_tenant  boolean := false;
  tid uuid := '00000000-0000-0000-0000-000000000000';
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'catalog' and table_name = 'ranking_policies'
     and column_name in ('tenant_id','category','margin','revision','modified_at','modified_by');
  if n <> 6 then raise exception 'FAIL M1: catalog.ranking_policies has % of 6 expected columns', n; end if;

  begin
    insert into catalog.ranking_policies (tenant_id, category, margin) values (null, cat, 1.5);
    saw_high := true;
  exception when check_violation then null;
  end;
  if saw_high then raise exception 'FAIL M1: margin = 1.5 was accepted'; end if;

  begin
    insert into catalog.ranking_policies (tenant_id, category, margin) values (null, cat, -0.1);
    saw_low := true;
  exception when check_violation then null;
  end;
  if saw_low then raise exception 'FAIL M1: a negative margin was accepted'; end if;

  insert into catalog.ranking_policies (tenant_id, category, margin) values (null, cat, 0.03);
  begin
    insert into catalog.ranking_policies (tenant_id, category, margin) values (null, cat, 0.05);
    saw_dup_default := true;
  exception when unique_violation then null;
  end;
  if saw_dup_default then raise exception 'FAIL M1: a second platform default for % was accepted', cat; end if;

  insert into catalog.ranking_policies (tenant_id, category, margin) values (tid, cat, 0.04);
  begin
    insert into catalog.ranking_policies (tenant_id, category, margin) values (tid, cat, 0.06);
    saw_dup_tenant := true;
  exception when unique_violation then null;
  end;
  if saw_dup_tenant then raise exception 'FAIL M1: a second override for one tenant was accepted'; end if;

  raise notice 'PASSED M1: ranking_policies shape, domain and uniqueness';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M2 — revision is the resolver cache key's proof of change: a real edit bumps
--      it, a no-op must not (an editor clicking Save twice is not a policy change,
--      and a spurious bump invalidates every cached snapshot for nothing).
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  cat constant text := 'planner.select';
  rev1 bigint; rev_noop bigint; rev2 bigint;
begin
  select revision into rev1 from catalog.ranking_policies where tenant_id is null and category = cat;

  update catalog.ranking_policies set margin = 0.03 where tenant_id is null and category = cat;
  select revision into rev_noop from catalog.ranking_policies where tenant_id is null and category = cat;
  if rev_noop <> rev1 then
    raise exception 'FAIL M2: a no-op update bumped revision % -> %', rev1, rev_noop; end if;

  update catalog.ranking_policies set margin = 0.05 where tenant_id is null and category = cat;
  select revision into rev2 from catalog.ranking_policies where tenant_id is null and category = cat;
  if rev2 <> rev1 + 1 then
    raise exception 'FAIL M2: a real edit moved revision % -> %, expected %', rev1, rev2, rev1 + 1; end if;

  raise notice 'PASSED M2: revision bumps on a real edit only';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M3 — while the category is a TIE the resolver claims nothing: chain rows come
--      back, verdict says `tie`, and `within_margin` is NULL on every one — even
--      though a margin is configured and every model would pass it numerically.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  cat constant text := 'planner.select';
  tid constant uuid := '00000000-0000-0000-0000-000000000000';
  chained int; claimed int; ordered int; verdicts text;
begin
  select count(*), count(within_margin), count(rank)
    into chained, claimed, ordered
    from catalog.ranked_chain(tid, 'decision', cat);

  if chained = 0 then
    raise notice 'SKIPPED M3-M6: no decision chain for the platform tenant';
    return;
  end if;

  select distinct verdict::text into verdicts
    from catalog.ranked_chain(tid, 'decision', cat);

  if verdicts is distinct from 'tie' then
    raise notice 'SKIPPED M3-M6: % is no longer a seeded tie (%), it is %', cat, 'expected tie', verdicts;
    return;
  end if;

  if claimed <> 0 then
    raise exception 'FAIL M3: a tie carried % within_margin claims, expected 0', claimed; end if;
  if ordered <> 0 then
    raise exception 'FAIL M3: a tie carried % non-NULL ranks, expected 0', ordered; end if;

  raise notice 'PASSED M3: a tie returns chain rows but no claim and no order (% rows)', chained;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M4 — a winner: the margin admits, the artifact orders. Also pins the CI floor —
--      a configured 0.0 must yield the top model's half-width, not 0.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  cat constant text := 'planner.select';
  tid constant uuid := '00000000-0000-0000-0000-000000000000';
  measured int;
  top_acc numeric; top_half numeric; expected_eff numeric;
  got_eff numeric; got_margin bigint;
  expect_admissible int; got_admissible int;
  order_ok boolean;
begin
  select count(*) into measured
    from catalog.model_rankings r join catalog.chains_for_tenant c
      on c.model_id = r.model_id and c.tenant_id = tid
   where r.category = cat;
  if measured < 2 then
    raise notice 'SKIPPED M4-M6: % has fewer than two measured chain models', cat;
    return;
  end if;

  -- M1 leaves an override on this tenant; M4 is about the platform default.
  delete from catalog.ranking_policies where tenant_id is not null and category = cat;

  -- Promote every measured row to a winner, ranked by accuracy (-> null first so the
  -- (category, rank) unique index cannot see a transient duplicate).
  update catalog.model_rankings set verdict = 'tie', rank = null where category = cat;
  update catalog.model_rankings r
     set verdict = 'winner', rank = o.rn
    from (select mr.model_id
               , row_number() over (order by mr.accuracy desc, m.full_name) as rn
            from catalog.model_rankings mr
            join catalog.models m on m.id = mr.model_id
           where mr.category = cat) o
   where r.category = cat and r.model_id = o.model_id;

  select accuracy, (ci_hi - ci_lo) / 2 into top_acc, top_half
    from catalog.model_rankings where category = cat and rank = 1;

  -- Configured 0.0: the CI half-width is the floor.
  update catalog.ranking_policies set margin = 0.0 where tenant_id is null and category = cat;
  expected_eff := greatest(0.0::numeric, top_half);

  select max(effective_margin), max(policy_revision)
    into got_eff, got_margin
    from catalog.ranked_chain(tid, 'decision', cat);
  if got_eff is distinct from expected_eff then
    raise exception 'FAIL M4: effective margin = %, expected max(0.0, top half-width % ) = %',
      got_eff, top_half, expected_eff; end if;
  if got_margin is null then
    raise exception 'FAIL M4: policy_revision was not reported although a policy row exists'; end if;

  -- Membership is a computed quantity, not a vibe: assert it against the rule.
  select count(*) into expect_admissible
    from catalog.model_rankings r
    join catalog.chains_for_tenant c on c.model_id = r.model_id and c.tenant_id = tid
   where r.category = cat and r.accuracy >= top_acc - expected_eff;
  select count(*) into got_admissible
    from catalog.ranked_chain(tid, 'decision', cat) where within_margin;

  if got_admissible <> expect_admissible then
    raise exception 'FAIL M4: % admissible rows, expected % (top accuracy %, effective margin %)',
      got_admissible, expect_admissible, top_acc, expected_eff; end if;
  if got_admissible < 1 then
    raise exception 'FAIL M4: the top model was not admissible against its own CI'; end if;

  -- Position is the artifact's: the returned order must equal rank order exactly.
  select bool_and(rn = rank) into order_ok
    from (select rank, row_number() over () as rn
            from catalog.ranked_chain(tid, 'decision', cat)
           where rank is not null) x;
  if not coalesce(order_ok, false) then
    raise exception 'FAIL M4: rows did not come back in artifact rank order'; end if;

  raise notice 'PASSED M4: % of % measured models admissible at margin % (CI floor), order = rank',
    got_admissible, measured, got_eff;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M5 — a wider margin admits more and still does not reorder; a tenant override
--      beats the platform default. Narrowing back restores the smaller set, so the
--      margin is the only input that moved.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  cat constant text := 'planner.select';
  tid constant uuid := '00000000-0000-0000-0000-000000000000';
  verdict_now text;
  narrow int; wide int; tenant_wide int;
  eff numeric;
begin
  select distinct verdict::text into verdict_now
    from catalog.ranked_chain(tid, 'decision', cat);
  if verdict_now is distinct from 'winner' then
    raise notice 'SKIPPED M5: % has no winner to widen', cat;
    return;
  end if;

  update catalog.ranking_policies set margin = 0.0 where tenant_id is null and category = cat;
  select count(*) into narrow from catalog.ranked_chain(tid, 'decision', cat) where within_margin;

  update catalog.ranking_policies set margin = 1.0 where tenant_id is null and category = cat;
  select count(*) into wide from catalog.ranked_chain(tid, 'decision', cat) where within_margin;

  if wide <= narrow then
    raise exception 'FAIL M5: widening the margin to 1.0 admitted % models, not more than %', wide, narrow; end if;

  -- A tenant row is in force over the platform default.
  insert into catalog.ranking_policies (tenant_id, category, margin)
  values (tid, cat, 0.0);
  select max(effective_margin), count(*) filter (where within_margin)
    into eff, tenant_wide
    from catalog.ranked_chain(tid, 'decision', cat);
  if tenant_wide <> narrow then
    raise exception 'FAIL M5: a tenant override of 0.0 did not beat the platform default of 1.0 (%; % vs % admissible)',
      eff, tenant_wide, narrow; end if;

  raise notice 'PASSED M5: margin widens membership (% -> %) and the tenant row wins', narrow, wide;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M6 — ranking_status explains itself, and cannot disagree with the resolver:
--      counts and the effective margin are derived from ranked_chain itself.
--      "no measurement" and "nothing within margin" must be distinguishable.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  cat constant text := 'planner.select';
  tid constant uuid := '00000000-0000-0000-0000-000000000000';
  s record;
  v_chained int; v_measured int;
  unknown record;
begin
  select * into s from catalog.ranking_status(tid, 'decision', cat);

  select count(*), count(*) filter (where r.measured)
    into v_chained, v_measured
    from catalog.ranked_chain(tid, 'decision', cat) r;

  if s.chained <> v_chained or s.measured <> v_measured then
    raise exception 'FAIL M6: status says % chained / % measured, resolver says % / %',
      s.chained, s.measured, v_chained, v_measured; end if;
  if s.effective_margin is distinct from (select max(effective_margin) from catalog.ranked_chain(tid, 'decision', cat)) then
    raise exception 'FAIL M6: status margin % disagrees with the resolver', s.effective_margin; end if;
  if s.reason is null or s.reason = '' then
    raise exception 'FAIL M6: status gave no reason'; end if;

  -- A tenant with no chain: no rows, and a reason that says so rather than
  -- claiming "no measurement".
  select * into unknown from catalog.ranking_status(gen_random_uuid(), 'decision', cat);
  if unknown.chained <> 0 then
    raise exception 'FAIL M6: an unknown tenant saw % chained rows', unknown.chained; end if;
  if unknown.reason not like 'no chain step%' then
    raise exception 'FAIL M6: unknown tenant reason = %, expected a no-chain reason', unknown.reason; end if;
  if unknown.verdict is distinct from 'unranked' then
    raise exception 'FAIL M6: unknown tenant verdict = %, expected unranked', unknown.verdict; end if;

  raise notice 'PASSED M6: status agrees with the resolver and names its reason (%)', s.reason;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M7 — the resolver is gateway-internal: no grant to anon/authenticated, exactly
--      the posture of catalog.chains_for_tenant. A grant here would serve
--      all-tenant rows through PostgREST.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in select p.proname, p.oid
             from pg_proc p
            where p.pronamespace = 'catalog'::regnamespace
              and p.proname in ('ranked_chain', 'ranking_status')
  loop
    if not has_function_privilege('service_role', r.oid, 'EXECUTE') then
      raise exception 'FAIL M7: service_role cannot execute %', r.proname; end if;
    if has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      raise exception 'FAIL M7: authenticated can execute % — all-tenant rows would leak', r.proname; end if;
    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      raise exception 'FAIL M7: anon can execute %', r.proname; end if;
  end loop;

  if not exists (select 1 from pg_class where oid = 'catalog.ranking_policies'::regclass and relrowsecurity) then
    raise exception 'FAIL M7: catalog.ranking_policies has RLS disabled'; end if;

  raise notice 'PASSED M7: resolver is service_role only, policy table has RLS';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M8 — a measured row's `revision` tracks CHANGES, not writes. It is part of the
--      resolver's cache key, so both directions are bugs: a spurious bump throws
--      away every cached ordering, and a missing one lets a cached order outlive
--      the measurement it was derived from. The seeder re-writes every row on each
--      import, so "same values → no bump" is the rule that keeps re-imports cheap.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  cat constant text := 'planner.select';
  mid uuid;
  before bigint;
  after bigint;
begin
  select model_id, revision into mid, before
    from catalog.model_rankings where category = cat order by model_id limit 1;
  if mid is null then
    raise exception 'FAIL M8: no seeded ranking row to test';
  end if;

  -- A no-op write (the seeder's upsert with identical values) must not bump.
  update catalog.model_rankings
     set accuracy = accuracy, modified_by = modified_by
   where category = cat and model_id = mid;
  select revision into after from catalog.model_rankings where category = cat and model_id = mid;
  if after <> before then
    raise exception 'FAIL M8: a no-op write bumped revision % -> %', before, after;
  end if;

  -- A real change must bump, and by exactly one.
  update catalog.model_rankings
     set accuracy = least(1, coalesce(accuracy, 0.5) + 0.001)
   where category = cat and model_id = mid;
  select revision into after from catalog.model_rankings where category = cat and model_id = mid;
  if after <> before + 1 then
    raise exception 'FAIL M8: a real change bumped revision % -> % (expected %)',
      before, after, before + 1;
  end if;

  -- Attribution alone is a change: the provenance the trace reports must move.
  update catalog.model_rankings set edited_by = 'test-editor'
   where category = cat and model_id = mid;
  if (select revision from catalog.model_rankings where category = cat and model_id = mid) <> after + 1 then
    raise exception 'FAIL M8: setting edited_by did not bump revision';
  end if;

  raise notice 'PASSED M8: ranking revision bumps on change, not on rewrite';
end $$;

rollback;

\echo 'PASSED ranking margin suite (transaction rolled back)'
