-- RLS · F1-rework new tables (RW3–RW15). Grants + policies in one place.
-- RW1 model: privileged tables SELECT-only for authenticated (writes = service_role
-- via the gateway); benign self-owned tables get owner-scoped DML. Idempotent.

-- ── (A) Privileged tables — SELECT-only for authenticated ──────────────────────
do $$
declare r record;
begin
  for r in select * from (values
    ('public', 'budget_holds'),
    ('core', 'service_accounts'),
    ('core', 'api_keys'),
    ('governance', 'feature_policies'),
    ('audit', 'notification_channels'),
    ('public', 'alert_rules'),
    ('public', 'alert_events'),
    ('catalog', 'provider_overrides'),
    ('catalog', 'chain_bindings'),
    ('catalog', 'routing_policies'),
    ('catalog', 'provider_health'),
    ('metering', 'quality_signals'),  -- §D Ledger Normalize: moved public→metering (split from feedback)
    ('public', 'structured_datasets'),
    ('public', 'dataset_columns'),
    ('device', 'tenant_mcp_servers'),
    ('device', 'tool_allow_lists'),
    ('metering', 'usage_daily'),      -- §D Phase 6: was public.analytics_usage_daily
    ('metering', 'quality_daily'),    -- §D Phase 6: was public.analytics_quality_daily
    ('config', 'config_versions')
  ) as x(sch, tbl)
  loop
    execute format('alter table %I.%I enable row level security', r.sch, r.tbl);
    execute format('revoke all on %I.%I from anon, authenticated, public', r.sch, r.tbl);
    execute format('grant select on %I.%I to authenticated', r.sch, r.tbl);
    execute format('grant select, insert, update, delete on %I.%I to service_role', r.sch, r.tbl);
    execute format('drop policy if exists %I on %I.%I', r.tbl || '_read', r.sch, r.tbl);
    execute format(
      'create policy %I on %I.%I for select to authenticated using (tenant_id = (auth.jwt() ->> %L)::uuid)',
      r.tbl || '_read', r.sch, r.tbl, 'tenant_id'
    );
  end loop;
end $$;

-- api_keys: never expose the hash/secret to clients even on SELECT — revoke the
-- column so PostgREST cannot return it (defense-in-depth; service_role only).
revoke select (hashed_secret) on core.api_keys from authenticated;

-- ── (B) Self-owned benign tables — owner-scoped DML ────────────────────────────
-- user_preferences: owner only.
alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated, public;
grant select, insert, update, delete on public.user_preferences to authenticated;
grant select, insert, update, delete on public.user_preferences to service_role;
drop policy if exists user_preferences_self on public.user_preferences;
create policy user_preferences_self on public.user_preferences for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and profile_id = auth.uid())
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and profile_id = auth.uid());

-- budget_requests: member may SELECT own + INSERT an own PENDING request; approve
-- (status change) is service_role only (no UPDATE/DELETE grant to authenticated).
alter table public.budget_requests enable row level security;
revoke all on public.budget_requests from anon, authenticated, public;
grant select, insert on public.budget_requests to authenticated;
grant select, insert, update, delete on public.budget_requests to service_role;
drop policy if exists budget_requests_select on public.budget_requests;
create policy budget_requests_select on public.budget_requests for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and requested_by = auth.uid());
drop policy if exists budget_requests_insert on public.budget_requests;
create policy budget_requests_insert on public.budget_requests for insert to authenticated
  with check (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and requested_by = auth.uid()
    and status = 'pending'
  );

-- conversations: owner-scoped.
alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated, public;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.conversations to service_role;
drop policy if exists conversations_owner on public.conversations;
create policy conversations_owner on public.conversations for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and owner_id = auth.uid())
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and owner_id = auth.uid());

-- messages / message_citations: inherit the parent conversation's ownership.
do $$
declare r record;
begin
  for r in select * from (values ('messages','conversation_id','conversations'),
                                 ('message_citations','message_id','messages')) as x(tbl, fk, parent)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('revoke all on public.%I from anon, authenticated, public', r.tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tbl);
    execute format('grant select, insert, update, delete on public.%I to service_role', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_owner', r.tbl);
  end loop;
end $$;
create policy messages_owner on public.messages for all to authenticated
  using (exists (select 1 from public.conversations c
                 where c.tenant_id = messages.tenant_id and c.id = messages.conversation_id
                   and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.conversations c
                 where c.tenant_id = messages.tenant_id and c.id = messages.conversation_id
                   and c.owner_id = auth.uid()));
create policy message_citations_owner on public.message_citations for all to authenticated
  using (exists (select 1 from public.messages m join public.conversations c
                   on c.tenant_id = m.tenant_id and c.id = m.conversation_id
                 where m.tenant_id = message_citations.tenant_id and m.id = message_citations.message_id
                   and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.messages m join public.conversations c
                   on c.tenant_id = m.tenant_id and c.id = m.conversation_id
                 where m.tenant_id = message_citations.tenant_id and m.id = message_citations.message_id
                   and c.owner_id = auth.uid()));

-- ── (C) MCP registry — platform + own-tenant readable (nullable/absent tenant_id)
alter table device.mcp_servers enable row level security;
revoke all on device.mcp_servers from anon, authenticated, public;
grant select on device.mcp_servers to authenticated;
grant select, insert, update, delete on device.mcp_servers to service_role;
drop policy if exists mcp_servers_read on device.mcp_servers;
create policy mcp_servers_read on device.mcp_servers for select to authenticated
  using (tenant_id is null or tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

alter table device.mcp_server_tools enable row level security;
revoke all on device.mcp_server_tools from anon, authenticated, public;
grant select on device.mcp_server_tools to authenticated;
grant select, insert, update, delete on device.mcp_server_tools to service_role;
drop policy if exists mcp_server_tools_read on device.mcp_server_tools;
create policy mcp_server_tools_read on device.mcp_server_tools for select to authenticated
  using (exists (select 1 from device.mcp_servers s
                 where s.id = mcp_server_tools.mcp_server_id
                   and (s.tenant_id is null or s.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)));

-- ── (D) config catalog + tenant read grants (RW10 fix: UIs were permission-denied)
grant usage on schema config to authenticated;
grant select on all tables in schema config to authenticated;
-- catalog: the model/router/provider catalog moved config→catalog (§D). Bulk-grant like config so the
-- reference tables (routers/providers/models/model_endpoints/model_capabilities/capability_types) stay
-- readable by authenticated on a FRESH build (the config bulk grant above no longer reaches them).
grant usage on schema catalog to authenticated;
grant select on all tables in schema catalog to authenticated;
-- ...EXCEPT the gateway-internal shield views: `grant ... on all tables` sweeps in views too, and
-- catalog.chains_for_tenant carries EVERY tenant's resolved chains/pricing with no security_invoker
-- (owner-rights view) — exposing it to authenticated would be a cross-tenant leak. Carve it back out
-- (mirrors the core.api_keys hashed_secret revoke above). It is read only by the service_role gateway.
revoke select on catalog.chains_for_tenant from authenticated;
-- governance LOOKUPS moved config→governance (§D Phase 4: features/modules). Grant them EXPLICITLY
-- (not a blanket `grant on all tables in schema governance`) so the gateway-internal shield
-- feature_governance_for_tenant — all-tenant rows, no security_invoker — is never swept in. The
-- config bulk grant above no longer reaches these on a fresh build.
grant usage on schema governance to authenticated;
grant select on governance.features to authenticated;
grant select on governance.modules  to authenticated;
grant select on core.tenants to authenticated;
alter table core.tenants enable row level security;
drop policy if exists tenants_self on core.tenants;
create policy tenants_self on core.tenants for select to authenticated
  using (id = (auth.jwt() ->> 'tenant_id')::uuid);
