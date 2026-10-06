-- TM-6 (torii#24, gateway epic #76): the orchestrator's durable state, tenant-scoped.
-- `registry.*` holds agent/skill/tool definitions + (area, kind) → chain bindings;
-- `runs.*` holds run state (schedule, journal, snapshots, content, blackboard).
-- Gateway is a library; torii owns persistence (DECISIONS §11) — these replace the gateway's
-- single-tenant `orchestrator` schema, whose global config_versions singleton let one tenant's
-- push strand every other tenant's paused runs.
\set ON_ERROR_STOP on
begin;

-- Fixture: two tenants. Platform (0000…) is bootstrapped by core.tenants; a foreign tenant
-- is added here and rolled back.
insert into core.tenants (id, name, slug, modified_by)
values ('99999999-9999-9999-9999-999999999999', 'Tenant B', 'tm6-tenant-b', 'tm6-test')
on conflict (id) do nothing;

-- ── shape: every table is tenant-keyed and RLS-shielded ────────────────────────
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('registry','agents'), ('registry','skills'), ('registry','tools'),
      ('registry','chain_bindings'),
      ('runs','scheduled_runs'), ('runs','journal_events'), ('runs','run_snapshots'),
      ('runs','cas_blobs'), ('runs','context_refs'), ('runs','runs')
    ) as v(sch, tbl)
  loop
    if to_regclass(format('%I.%I', t.sch, t.tbl)) is null then
      raise exception 'FAIL shape: %.% does not exist', t.sch, t.tbl;
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = t.sch and table_name = t.tbl
                      and column_name = 'tenant_id' and is_nullable = 'NO') then
      raise exception 'FAIL shape: %.% has no NOT NULL tenant_id', t.sch, t.tbl;
    end if;
    if not (select relrowsecurity from pg_class
             where oid = format('%I.%I', t.sch, t.tbl)::regclass) then
      raise exception 'FAIL shape: %.% does not enable RLS', t.sch, t.tbl;
    end if;
    -- The primary key leads with tenant_id, so no key is unique across tenants.
    if (select a.attname from pg_index i
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
         where i.indrelid = format('%I.%I', t.sch, t.tbl)::regclass and i.indisprimary)
       <> 'tenant_id' then
      raise exception 'FAIL shape: %.% primary key does not lead with tenant_id', t.sch, t.tbl;
    end if;
  end loop;
  raise notice 'shape OK';
end $$;

-- Rows for BOTH tenants, written as the owner (the service path).
insert into registry.agents (tenant_id, name, def) values
  ('00000000-0000-0000-0000-000000000000', 'mine',   '{"name":"mine"}'),
  ('99999999-9999-9999-9999-999999999999', 'theirs', '{"name":"theirs"}');
insert into registry.chain_bindings (tenant_id, area, kind, chain) values
  ('99999999-9999-9999-9999-999999999999', 'research', 'lead', 'their-chain');
insert into runs.scheduled_runs (tenant_id, run_id, graph, status) values
  ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-0000-0000-0000-000000000001', '{"nodes":[]}', 'paused');
insert into runs.journal_events (tenant_id, run_id, event) values
  ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-0000-0000-0000-000000000001', '{"NodeStarted":{"node":"n"}}');
insert into runs.cas_blobs (tenant_id, digest, bytes) values
  ('99999999-9999-9999-9999-999999999999', 'd1', '\x00');
insert into runs.context_refs (tenant_id, run_id, scope_kind, scope_id, ctx_key, ctx_ref) values
  ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-0000-0000-0000-000000000001', 'run', '', 'k', '{}');

-- The same digest in two tenants is two rows: the CAS is per tenant, not shared.
insert into runs.cas_blobs (tenant_id, digest, bytes) values
  ('00000000-0000-0000-0000-000000000000', 'd1', '\x00');

-- ── isolation: an authenticated member of the platform tenant ─────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","tenant_id":"00000000-0000-0000-0000-000000000000"}';

do $$
begin
  -- Specific foreign rows are invisible (not count(*)=0: other suites may seed rows).
  if exists (select 1 from registry.agents where tenant_id = '99999999-9999-9999-9999-999999999999') then
    raise exception 'FAIL isolation: tenant B''s agent is visible to tenant A';
  end if;
  if not exists (select 1 from registry.agents where name = 'mine') then
    raise exception 'FAIL isolation: tenant A cannot read its own agent';
  end if;
  if exists (select 1 from registry.chain_bindings where tenant_id = '99999999-9999-9999-9999-999999999999')
     or exists (select 1 from runs.scheduled_runs where tenant_id = '99999999-9999-9999-9999-999999999999')
     or exists (select 1 from runs.journal_events where tenant_id = '99999999-9999-9999-9999-999999999999')
     or exists (select 1 from runs.cas_blobs where tenant_id = '99999999-9999-9999-9999-999999999999')
     or exists (select 1 from runs.context_refs where tenant_id = '99999999-9999-9999-9999-999999999999') then
    raise exception 'FAIL isolation: a tenant B run/registry row is visible to tenant A';
  end if;
  raise notice 'isolation OK';
end $$;

-- authenticated cannot write orchestrator state — writes go through the service (service_role).
do $$
begin
  begin
    insert into registry.agents (tenant_id, name, def)
    values ('00000000-0000-0000-0000-000000000000', 'forged', '{}');
    raise exception 'FAIL authz: authenticated inserted into registry.agents';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into runs.journal_events (tenant_id, run_id, event)
    values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000002', '{}');
    raise exception 'FAIL authz: authenticated appended to runs.journal_events';
  exception when insufficient_privilege then null;
  end;
  begin
    update runs.scheduled_runs set status = 'cancelled';
    raise exception 'FAIL authz: authenticated updated runs.scheduled_runs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform registry.bump_generation('00000000-0000-0000-0000-000000000000', null);
    raise exception 'FAIL authz: authenticated could bump the registry generation';
  exception when insufficient_privilege then null;
  end;
  raise notice 'authz OK';
end $$;

reset role;

-- ── service_role writes ──────────────────────────────────────────────────────
set local role service_role;
insert into runs.journal_events (tenant_id, run_id, event)
values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000003', '{}');
reset role;

-- ── the registry generation: a per-tenant CAS on config_versions' 'registry' component ──
-- Run as service_role — the only role the functions are granted to, so the grant chain they
-- need (schema usage on config, execute on config.bump_config_version) is exercised.
set local role service_role;
do $$
declare
  a constant uuid := '00000000-0000-0000-0000-000000000000';
  b constant uuid := '99999999-9999-9999-9999-999999999999';
  g0 bigint; g bigint; overall bigint;
begin
  g0 := registry.generation(b);
  if g0 <> 0 then
    raise exception 'FAIL generation: a tenant that never published is at %, not 0', g0;
  end if;
  g := registry.bump_generation(b, 0);
  if g is distinct from 1 then
    raise exception 'FAIL generation: first publish at 0 returned %, not 1', g;
  end if;
  g := registry.bump_generation(b, 0);
  if g is not null then
    raise exception 'FAIL generation: a stale expectation must return null, got %', g;
  end if;
  if registry.generation(b) <> 1 then
    raise exception 'FAIL generation: a refused publish moved the generation';
  end if;
  g := registry.bump_generation(b, null);
  if g is distinct from 2 then
    raise exception 'FAIL generation: an unconditional publish returned %, not 2', g;
  end if;

  -- Another component (catalog) moving does NOT move the registry generation — so a catalog
  -- edit never strands paused runs — but the registry bump DOES advance the tenant's overall
  -- version, so torii's config snapshot sees it.
  select version into overall from config.config_versions where tenant_id = b;
  perform config.bump_config_version(b, 'catalog');
  if registry.generation(b) <> 2 then
    raise exception 'FAIL generation: a catalog bump moved the registry generation';
  end if;
  if (select version from config.config_versions where tenant_id = b) <> overall + 1 then
    raise exception 'FAIL generation: the catalog bump did not advance the overall version';
  end if;

  -- Per tenant: tenant B's publishes never move tenant A's generation.
  g0 := registry.generation(a);
  perform registry.bump_generation(b, null);
  if registry.generation(a) <> g0 then
    raise exception 'FAIL generation: tenant B''s publish moved tenant A''s generation';
  end if;
  raise notice 'generation OK';
end $$;
reset role;

rollback;
