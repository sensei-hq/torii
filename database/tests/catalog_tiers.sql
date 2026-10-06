-- G2 — tiers as a catalog dimension, and chains composed of tier-refs.
--
-- WHY THIS TEST EXISTS: the gateway models tiers and chains as ORTHOGONAL axes. A tier is a
-- named segment with an intra-tier strategy; a chain is an ordered list of tier-refs (or
-- concrete models). Membership is CURATED ∪ ATTRIBUTE-DERIVED, which buys the property the
-- gateway's own scenario asks for: "adding a model to a tier updates every chain that
-- references it" — no chain edit.
--
-- Two traps this pins, both of the same family (what does "absent" mean?):
--   · an EMPTY derivation dimension must mean "do not filter on it", not "match nothing";
--   · a tier with NO derivation at all must match NOTHING derived — otherwise a purely
--     curated tier silently swallows the entire catalog.
-- Getting either backwards produces a tier that looks populated and routes wrongly.
\set ON_ERROR_STOP on
\echo '== catalog tiers: strategy, curated ∪ derived membership, tier-ref chain steps =='

-- ─────────────────────────────────────────────────────────────────────────
-- T1 — the intra-tier strategy enum exists with exactly the gateway's four.
--      `headroom`/`least_used` are DYNAMIC (need live usage) and currently stub to
--      `priority` in the engine; they are still valid stored config.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare vals text;
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'catalog' and t.typname = 'intra_tier_strategy' and t.typtype = 'e')
  then raise exception 'FAIL: enum catalog.intra_tier_strategy does not exist'; end if;

  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into vals
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'catalog' and t.typname = 'intra_tier_strategy';
  if vals is distinct from 'priority,cost,headroom,least_used' then
    raise exception 'FAIL: intra_tier_strategy = %, expected priority,cost,headroom,least_used', vals; end if;
  raise notice 'PASSED T1: catalog.intra_tier_strategy exact';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- T2 — catalog.tiers + catalog.tier_models exist, tenant-scoped like chains.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'catalog' and table_name = 'tiers'
     and column_name in ('tenant_id','id','name','strategy','derive_auth_types','derive_cost_bands',
                         'derive_free_types','derive_localities','derive_tags','derive_capability_id','is_active');
  if n <> 11 then raise exception 'FAIL: catalog.tiers has % of 11 expected columns', n; end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'catalog' and table_name = 'tier_models'
     and column_name in ('tenant_id','id','tier_id','model_id');
  if n <> 4 then raise exception 'FAIL: catalog.tier_models has % of 4 expected columns', n; end if;
  raise notice 'PASSED T2: catalog.tiers + tier_models shape';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- T3 — a chain step is a concrete model XOR a tier-ref. A step that is both, or
--      neither, is unrepresentable.
-- ─────────────────────────────────────────────────────────────────────────
do $$
-- `both`/`neither` would be reserved-word collisions here (trim(both …)), hence saw_*.
declare tid uuid; cid uuid; rid uuid; mid uuid; trid uuid; saw_both boolean := false; saw_neither boolean := false;
begin
  select id into tid from core.tenants where is_platform limit 1;
  select id into rid from catalog.routers limit 1;
  select id into mid from catalog.models limit 1;
  if tid is null or rid is null or mid is null then
    raise notice 'SKIPPED T3: no platform tenant / routers / models seeded'; return; end if;

  insert into catalog.chains (tenant_id, name, capability_id, modified_by)
    select tid, 'g2-xor-chain', ct.id, 'test' from catalog.capability_types ct limit 1
    returning id into cid;
  insert into catalog.tiers (tenant_id, name, modified_by) values (tid, 'g2-xor-tier', 'test')
    returning id into trid;

  begin
    insert into catalog.chain_models (tenant_id, fallback_chain_id, router_id, model_id, tier_id, sequence_order, modified_by)
      values (tid, cid, rid, mid, trid, 1, 'test');
  exception when check_violation then saw_both := true;
  end;
  begin
    insert into catalog.chain_models (tenant_id, fallback_chain_id, sequence_order, modified_by)
      values (tid, cid, 2, 'test');
  exception when check_violation then saw_neither := true;
  end;

  delete from catalog.chain_models where tenant_id = tid and fallback_chain_id = cid;
  delete from catalog.chains where tenant_id = tid and id = cid;
  delete from catalog.tiers  where tenant_id = tid and id = trid;

  if not saw_both then raise exception 'FAIL: a step with BOTH model and tier was accepted'; end if;
  if not saw_neither then raise exception 'FAIL: a step with NEITHER model nor tier was accepted'; end if;
  raise notice 'PASSED T3: chain step is model XOR tier-ref';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- T4/T5/T6/T7 — effective membership: curated ∪ derived, and the two "absent"
--      traps. One fixture, four assertions.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  tid uuid; pid uuid;
  t_curated uuid; t_derived uuid; t_both uuid; t_partial uuid;
  m_plain uuid; m_reason uuid; m_free uuid;
  n int; src text;
begin
  select id into tid from core.tenants where is_platform limit 1;
  select id into pid from catalog.providers limit 1;
  if tid is null or pid is null then
    raise notice 'SKIPPED T4-T7: no platform tenant / providers seeded'; return; end if;

  -- three models with distinct attributes
  insert into catalog.models (provider_id, name, version, full_name, tags, cost_band, locality)
    values (pid, 'g2-plain', 'v1', 'g2-plain-v1', '{}', 'mid', 'cloud') returning id into m_plain;
  insert into catalog.models (provider_id, name, version, full_name, tags, cost_band, locality)
    values (pid, 'g2-reason', 'v1', 'g2-reason-v1', '{reasoning}', 'high', 'cloud') returning id into m_reason;
  insert into catalog.models (provider_id, name, version, full_name, tags, cost_band, locality, free_type, free_tos)
    values (pid, 'g2-free', 'v1', 'g2-free-v1', '{}', 'free', 'cloud', 'recurring_monthly', 'ok') returning id into m_free;

  -- a purely CURATED tier (no derivation) holding only g2-plain
  insert into catalog.tiers (tenant_id, name, modified_by) values (tid, 'g2-curated', 'test') returning id into t_curated;
  insert into catalog.tier_models (tenant_id, tier_id, model_id) values (tid, t_curated, m_plain);

  -- a purely DERIVED tier: tag = reasoning
  insert into catalog.tiers (tenant_id, name, derive_tags, modified_by)
    values (tid, 'g2-derived', '{reasoning}', 'test') returning id into t_derived;

  -- BOTH: curated g2-plain plus derived tag=reasoning
  insert into catalog.tiers (tenant_id, name, derive_tags, modified_by)
    values (tid, 'g2-both', '{reasoning}', 'test') returning id into t_both;
  insert into catalog.tier_models (tenant_id, tier_id, model_id) values (tid, t_both, m_plain);

  -- PARTIAL derivation: free_type set, every other dimension left empty. The empty ones
  -- must NOT filter, so this is "any free model", not "no models".
  insert into catalog.tiers (tenant_id, name, derive_free_types, derive_tags, modified_by)
    values (tid, 'g2-partial', '{recurring_monthly}', '{}', 'test') returning id into t_partial;

  -- T4 — curated membership resolves, and a no-derivation tier stays EXACTLY curated.
  select count(*) into n from catalog.effective_tier_models where tier_id = t_curated;
  if n <> 1 then
    raise exception 'FAIL T4: curated tier has % members, expected exactly 1 (a no-derivation tier must not match the catalog)', n; end if;
  select model_id, source into m_plain, src from catalog.effective_tier_models where tier_id = t_curated;
  if src is distinct from 'curated' then raise exception 'FAIL T4: source = %, expected curated', src; end if;
  raise notice 'PASSED T4: curated membership resolves; a no-derivation tier matches nothing derived';

  -- T5 — attribute-derived membership picks up the matching model with no curation.
  select count(*) into n from catalog.effective_tier_models where tier_id = t_derived;
  if n <> 1 then raise exception 'FAIL T5: derived tier has % members, expected 1', n; end if;
  if not exists (select 1 from catalog.effective_tier_models where tier_id = t_derived and model_id = m_reason) then
    raise exception 'FAIL T5: derived tier did not pick up the reasoning-tagged model'; end if;
  raise notice 'PASSED T5: attribute-derived membership picks up a matching model';

  -- T6 — union, deduped: curated ∪ derived = 2 distinct models, curated wins the label.
  select count(*) into n from catalog.effective_tier_models where tier_id = t_both;
  if n <> 2 then raise exception 'FAIL T6: curated ∪ derived = % members, expected 2', n; end if;
  select source into src from catalog.effective_tier_models where tier_id = t_both and model_id = m_plain;
  if src is distinct from 'curated' then
    raise exception 'FAIL T6: a curated model reported source %, expected curated', src; end if;
  raise notice 'PASSED T6: membership is a deduped union; curated takes precedence';

  -- T7 — an EMPTY dimension does not filter. free_type matches g2-free; the empty tag
  --      array must not reduce that to zero.
  select count(*) into n from catalog.effective_tier_models where tier_id = t_partial;
  if n <> 1 then
    raise exception 'FAIL T7: partial-derivation tier has % members, expected 1 (an empty dimension must not filter)', n; end if;
  if not exists (select 1 from catalog.effective_tier_models where tier_id = t_partial and model_id = m_free) then
    raise exception 'FAIL T7: partial-derivation tier did not match the free model'; end if;
  raise notice 'PASSED T7: an empty derivation dimension does not filter';

  delete from catalog.tier_models where tenant_id = tid and tier_id in (t_curated, t_derived, t_both, t_partial);
  delete from catalog.tiers where tenant_id = tid and id in (t_curated, t_derived, t_both, t_partial);
  delete from catalog.models where name in ('g2-plain','g2-reason','g2-free');
end $$;

\echo '== catalog tier tests complete =='
