-- RLS · tenant isolation
-- Every tenant-scoped (non-secret) table is readable/writable only within the
-- caller's tenant, keyed on the JWT tenant_id claim (auth.jwt() ->> 'tenant_id').
-- service_role bypasses RLS (bypassrls), so the central gateway is unaffected.
-- Idempotent (drop+create) so `dbd policies` is re-runnable.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('core',   'profile_tenants'),
      ('core',   'tenant_languages'),
      ('public', 'access_groups'),
      ('public', 'access_groups_lang'),
      ('public', 'document_access'),
      ('public', 'document_embeddings'),
      ('public', 'documents'),
      ('public', 'fallback_chains'),
      ('public', 'fallback_chain_models'),
      ('public', 'gateway_tasks'),
      ('public', 'gateway_task_logs'),
      ('public', 'group_levels'),
      ('public', 'group_levels_lang'),
      ('public', 'profile_groups'),
      ('public', 'sessions'),
      ('public', 'session_logs')
    ) as x(sch, tbl)
  loop
    execute format('alter table %I.%I enable row level security', r.sch, r.tbl);
    execute format('drop policy if exists %I on %I.%I', r.tbl || '_tenant', r.sch, r.tbl);
    execute format(
      'create policy %I on %I.%I for all to authenticated '
      || 'using (tenant_id = (auth.jwt() ->> %L)::uuid) '
      || 'with check (tenant_id = (auth.jwt() ->> %L)::uuid)',
      r.tbl || '_tenant', r.sch, r.tbl, 'tenant_id', 'tenant_id'
    );
  end loop;
end $$;
