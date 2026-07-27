-- Grants · table privileges for the API role (authenticated).
-- RW1 (gateway-mediated writes, DECISIONS §2 W1): privileged tables are
-- SELECT-only for `authenticated` — all privileged mutations (roles, budgets,
-- chains, governance, spaces, membership, catalog, credentials, the ledger, and
-- gateway-produced document derivatives) go through the central gateway as
-- service_role. `authenticated` gets INSERT/UPDATE/DELETE only on clearly
-- self-owned benign rows. Secret tables (router_credentials/credentials, tenant_keys)
-- are never granted here (secrets.sql: service_role only).

grant usage on schema public, core to authenticated;

-- (1) Privileged tables — SELECT only. Writes are service_role via the gateway.
do $$
declare r record;
begin
  for r in select * from (values
    ('core',   'profile_tenants'),
    ('core',   'roles'),
    ('core',   'role_permissions'),
    ('core',   'profile_roles'),
    ('core',   'tenant_languages'),
    ('public', 'fallback_chains'),
    ('public', 'fallback_chain_models'),
    ('public', 'spaces'),
    ('public', 'space_members'),
    ('public', 'budget_nodes'),
    ('public', 'settings'),
    ('public', 'devices'),
    ('public', 'document_embeddings'),   -- gateway-produced (ingestion); never client-written
    ('public', 'document_versions'),     -- gateway-produced
    ('public', 'document_assets'),       -- gateway-produced
    ('public', 'inference_calls'),       -- service_role-only ledger
    ('public', 'execution_traces'),      -- service_role-only ledger
    ('public', 'gateway_tasks'),
    ('public', 'gateway_task_logs')
  ) as x(sch, tbl)
  loop
    execute format('grant select on %I.%I to authenticated', r.sch, r.tbl);
    execute format('revoke insert, update, delete on %I.%I from authenticated', r.sch, r.tbl);
  end loop;
end $$;

-- (2) Self-owned benign tables — full DML (RLS restricts to the caller's rows).
do $$
declare r record;
begin
  for r in select * from (values
    ('public', 'documents'),             -- own drafts (classification change is service_role, knowledge.sql)
    ('public', 'document_collections'),  -- own/space collections
    ('public', 'sessions'),
    ('public', 'session_logs')
  ) as x(sch, tbl)
  loop
    execute format('grant select, insert, update, delete on %I.%I to authenticated', r.sch, r.tbl);
  end loop;
end $$;

-- (3) Reference rows readable by any authenticated user.
grant select on core.profiles to authenticated;      -- own row (RLS)
grant select on core.capabilities to authenticated;   -- global capability catalog

-- (4) audit_events: append-only — SELECT + INSERT (actor-bound, governance.sql);
-- UPDATE/DELETE are never granted to authenticated.
grant select, insert on public.audit_events to authenticated;
revoke update, delete on public.audit_events from authenticated;
