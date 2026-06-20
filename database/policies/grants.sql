-- Grants · table privileges for the API role (authenticated).
-- RLS (the other policy files) scopes WHICH rows are visible; these grants gate
-- table ACCESS. Secret tables (router_keys, tenant_keys) are intentionally NOT
-- granted to authenticated — only service_role (bypassrls) reaches them.
-- config catalog grants are tracked separately (shared reference data).

grant usage on schema public, core to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
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
    ('public', 'session_logs'),
    ('public', 'spaces'),
    ('public', 'space_members'),
    ('public', 'budget_nodes')
  ) as x(sch, tbl)
  loop
    execute format('grant select, insert, update, delete on %I.%I to authenticated', r.sch, r.tbl);
  end loop;
end $$;
