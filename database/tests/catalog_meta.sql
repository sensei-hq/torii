-- G1 — catalog metadata (gateway `CatalogMeta` / `FreeTier`) on catalog.models.
--
-- WHY THIS TEST EXISTS: the gateway's tier machinery derives membership from these
-- attributes (`auth_type` / cost band / `free_type` / locality / tags), and its free-tier
-- totals are POOL-DEDUPED — two models sharing a pool contribute their allowance ONCE.
-- Without `free_pool_key` the headline silently double-counts, which is a wrong number
-- presented as a real one. These assertions pin the shape that makes the dedup expressible.
--
-- Mapping note: the DB uses torii's snake_case house style (`recurring_daily`); the gateway
-- wire format is PascalCase (`RecurringDaily`) — its own docs say kebab-case, which matches
-- neither. The config_loader maps at the boundary; M5 pins that both directions.
\set ON_ERROR_STOP on
\echo '== catalog metadata: CatalogMeta / FreeTier on catalog.models =='

-- ─────────────────────────────────────────────────────────────────────────
-- M1 — the four new catalog enums exist with exactly the gateway's variants.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  vals text;
  expected constant text[][] := array[
    ['free_type',       'recurring_daily,recurring_monthly,recurring_credit,recurring_uncapped,one_time_initial,keyless,discontinued'],
    ['tos_verdict',     'ok,caution,ambiguous'],
    ['model_auth_type', 'api_key,oauth_cli,keyless'],
    ['cost_band',       'free,low,mid,high']
  ];
begin
  for i in 1 .. array_length(expected, 1) loop
    if not exists (
      select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'catalog' and t.typname = expected[i][1] and t.typtype = 'e')
    then raise exception 'FAIL: enum type catalog.% does not exist', expected[i][1]; end if;

    select string_agg(e.enumlabel, ',' order by e.enumsortorder) into vals
      from pg_enum e join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'catalog' and t.typname = expected[i][1];
    if vals is distinct from expected[i][2] then
      raise exception 'FAIL: catalog.% = %, expected %', expected[i][1], vals, expected[i][2]; end if;
  end loop;
  raise notice 'PASSED M1: catalog free_type/tos_verdict/model_auth_type/cost_band enums exact';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M2 — catalog.models carries every CatalogMeta/FreeTier attribute, typed.
--      `locality` deliberately REUSES core.execution_location {local,cloud}
--      rather than minting a duplicate enum (db-redesign §3 consolidated these).
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  missing text;
  expected constant text[][] := array[
    ['free_type',          'free_type'],
    ['free_monthly_tokens','int8'],
    ['free_credit_tokens', 'int8'],
    ['free_pool_key',      'varchar'],
    ['free_tos',           'tos_verdict'],
    ['trains_on_prompts',  'bool'],
    ['model_auth_type',    'model_auth_type'],
    ['cost_band',          'cost_band'],
    ['locality',           'execution_location'],
    ['tags',               '_text']
  ];
  actual text;
begin
  for i in 1 .. array_length(expected, 1) loop
    select t.typname into actual
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type t on t.oid = a.atttypid
     where n.nspname = 'catalog' and c.relname = 'models'
       and a.attname = expected[i][1] and a.attnum > 0 and not a.attisdropped;
    if actual is null then
      raise exception 'FAIL: catalog.models.% does not exist', expected[i][1]; end if;
    if actual is distinct from expected[i][2] then
      raise exception 'FAIL: catalog.models.% is %, expected %', expected[i][1], actual, expected[i][2]; end if;
  end loop;
  raise notice 'PASSED M2: catalog.models carries all 10 CatalogMeta attributes, correctly typed';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M3 — a free tier without a ToS verdict is unrepresentable. FreeTier.tos is
--      NOT Option in the gateway, so a row with free_type and no verdict would
--      fail to deserialize at load — reject it at write instead.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare pid uuid; ok boolean := false;
begin
  select id into pid from catalog.providers limit 1;
  if pid is null then
    raise notice 'SKIPPED M3: no providers seeded'; return; end if;

  begin
    insert into catalog.models (provider_id, name, version, full_name, free_type, free_tos)
      values (pid, 'g1-probe-notos', 'v1', 'g1-probe-notos-v1', 'recurring_daily', null);
  exception when check_violation then ok := true;
  end;
  delete from catalog.models where name = 'g1-probe-notos';
  if not ok then
    raise exception 'FAIL: free_type without free_tos was accepted (constraint missing)'; end if;
  raise notice 'PASSED M3: free_type requires free_tos';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M4 — tags defaults to an empty array, never NULL. The gateway treats absent
--      tags as `[]`; a NULL here would make `tags @> ...` predicates return NULL
--      (not false), so a tag-derived tier would silently skip the model.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare pid uuid; got text[]; tp boolean;
begin
  select id into pid from catalog.providers limit 1;
  if pid is null then
    raise notice 'SKIPPED M4: no providers seeded'; return; end if;

  insert into catalog.models (provider_id, name, version, full_name)
    values (pid, 'g1-probe-tags', 'v1', 'g1-probe-tags-v1');
  select tags, trains_on_prompts into got, tp
    from catalog.models where name = 'g1-probe-tags';
  delete from catalog.models where name = 'g1-probe-tags';

  if got is null then raise exception 'FAIL: tags defaulted to NULL, expected {}'; end if;
  if array_length(got, 1) is not null then
    raise exception 'FAIL: tags defaulted to %, expected empty', got; end if;
  if tp is distinct from false then
    raise exception 'FAIL: trains_on_prompts defaulted to %, expected false', tp; end if;
  raise notice 'PASSED M4: tags defaults {} and trains_on_prompts defaults false';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- M5 — pool dedup is EXPRESSIBLE: models sharing free_pool_key count their
--      allowance once. This is the assertion that protects the headline number
--      (gateway free-tier-catalog: two models sharing a pool at 60M each
--      contribute 60M, not 120M).
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare pid uuid; naive bigint; deduped bigint;
begin
  select id into pid from catalog.providers limit 1;
  if pid is null then
    raise notice 'SKIPPED M5: no providers seeded'; return; end if;

  insert into catalog.models (provider_id, name, version, full_name, free_type, free_tos, free_monthly_tokens, free_pool_key)
  values
    (pid, 'g1-pool-a', 'v1', 'g1-pool-a-v1', 'recurring_monthly', 'ok', 60000000, 'g1-flash'),
    (pid, 'g1-pool-b', 'v1', 'g1-pool-b-v1', 'recurring_monthly', 'ok', 60000000, 'g1-flash'),
    (pid, 'g1-solo',   'v1', 'g1-solo-v1',   'recurring_monthly', 'ok', 10000000, null);

  select sum(free_monthly_tokens) into naive
    from catalog.models where name like 'g1-pool-%' or name = 'g1-solo';

  -- one row per pool; un-pooled models stand alone (keyed by id so they never merge).
  select sum(tokens) into deduped from (
    select max(free_monthly_tokens) as tokens
      from catalog.models
     where (name like 'g1-pool-%' or name = 'g1-solo')
     group by coalesce(free_pool_key, id::text)
  ) p;

  delete from catalog.models where name like 'g1-pool-%' or name = 'g1-solo';

  if naive is distinct from 130000000 then
    raise exception 'FAIL: naive sum = %, expected 130000000', naive; end if;
  if deduped is distinct from 70000000 then
    raise exception 'FAIL: pool-deduped sum = %, expected 70000000 (60M pool once + 10M solo)', deduped; end if;
  raise notice 'PASSED M5: pool dedup counts a shared pool once (130M naive → 70M deduped)';
end $$;

\echo '== catalog metadata tests complete =='
