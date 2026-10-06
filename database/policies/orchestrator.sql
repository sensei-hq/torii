-- RLS · orchestrator state (TM-6, torii#24; gateway epic #76 — "Gateway is a library; torii owns
-- persistence", DECISIONS §11). registry.* (agent/skill/tool definitions + chain bindings) and
-- runs.* (schedule, journal, snapshots, blobs, blackboard) are PRIVILEGED: the torii worker writes
-- them as service_role (or as owner, filtering by tenant_id); `authenticated` may only read its own
-- tenant's rows, for observability. Idempotent (drop+create).
do $$
declare r record;
begin
  for r in select * from (values
    ('registry', 'agents'),
    ('registry', 'skills'),
    ('registry', 'tools'),
    ('registry', 'chain_bindings'),
    ('runs',     'runs'),
    ('runs',     'scheduled_runs'),
    ('runs',     'journal_events'),
    ('runs',     'run_snapshots'),
    ('runs',     'cas_blobs'),
    ('runs',     'context_refs')
  ) as x(sch, tbl)
  loop
    execute format('alter table %I.%I enable row level security', r.sch, r.tbl);
    execute format('revoke all on %I.%I from anon, authenticated, public', r.sch, r.tbl);
    execute format('grant select on %I.%I to authenticated', r.sch, r.tbl);
    execute format('grant select, insert, update, delete on %I.%I to service_role', r.sch, r.tbl);
    execute format('drop policy if exists %I on %I.%I', r.tbl || '_read', r.sch, r.tbl);
    execute format(
      'create policy %I on %I.%I for select to authenticated '
      || 'using (tenant_id = (auth.jwt() ->> %L)::uuid)',
      r.tbl || '_read', r.sch, r.tbl, 'tenant_id'
    );
  end loop;
end $$;
