-- RLS · tenant isolation (RW1: gateway-mediated writes)
-- Every tenant-scoped table is readable only within the caller's tenant (JWT
-- tenant_id claim). PRIVILEGED tables are SELECT-only for `authenticated` — their
-- writes happen as service_role through the central gateway (the capability check
-- lives in C1 + the SELECT-only grant). Belt-and-suspenders: the RLS policy is
-- also SELECT-only, so even a mis-granted write is denied by RLS. service_role
-- bypasses RLS. documents + gateway-produced doc derivatives → knowledge.sql.
-- Idempotent (drop+create).

-- (1) Privileged tables — SELECT-only policy for authenticated.
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
    -- devices: NOT tenant-wide — it has a bespoke own-vs-`device.manage` SELECT policy
    -- (devices_access in governance.sql). A generic `devices_read` here would OR with it
    -- and leak every in-tenant device to a plain member (O3-4).
    ('public', 'gateway_tasks'),
    ('public', 'gateway_task_logs'),
    ('public', 'inference_calls'),
    ('public', 'execution_traces')
  ) as x(sch, tbl)
  loop
    execute format('alter table %I.%I enable row level security', r.sch, r.tbl);
    execute format('drop policy if exists %I on %I.%I', r.tbl || '_tenant', r.sch, r.tbl);
    execute format('drop policy if exists %I on %I.%I', r.tbl || '_read', r.sch, r.tbl);
    execute format(
      'create policy %I on %I.%I for select to authenticated '
      || 'using (tenant_id = (auth.jwt() ->> %L)::uuid)',
      r.tbl || '_read', r.sch, r.tbl, 'tenant_id'
    );
  end loop;
end $$;

-- (2) Benign tenant-scoped tables — full DML within the caller's tenant (member's
-- own session/collection data; not privileged like roles/budgets/chains).
do $$
declare r record;
begin
  for r in select * from (values
    ('public', 'sessions'),
    ('public', 'session_logs'),
    ('public', 'document_collections')
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

-- (3) core.profiles — a user reads/updates only their OWN row (display prefs);
-- claims_version is bumped by the gateway (service_role), never self-raised.
alter table core.profiles enable row level security;
drop policy if exists profiles_self on core.profiles;
create policy profiles_self on core.profiles for select to authenticated
  using (id = auth.uid());

-- (4) core.capabilities — global reference catalog, readable by all authenticated.
alter table core.capabilities enable row level security;
drop policy if exists capabilities_read on core.capabilities;
create policy capabilities_read on core.capabilities for select to authenticated
  using (true);
