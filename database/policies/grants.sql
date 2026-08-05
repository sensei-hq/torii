-- Grants · table privileges for the API role (authenticated).
-- RW1 (gateway-mediated writes, DECISIONS §2 W1): privileged tables are
-- SELECT-only for `authenticated` — all privileged mutations (roles, budgets,
-- chains, governance, spaces, membership, catalog, credentials, the ledger, and
-- gateway-produced document derivatives) go through the central gateway as
-- service_role. `authenticated` gets INSERT/UPDATE/DELETE only on clearly
-- self-owned benign rows. Secret tables (router_credentials/credentials, tenant_keys)
-- are never granted here (secrets.sql: service_role only).

grant usage on schema public, core to authenticated;
-- metering: new domain schema (enum home for call_status; tables land in a later phase).
-- service_role (the gateway in prod) writes metering.inference_calls.status via the enum;
-- authenticated only reads it as text (json_agg), but usage keeps qualified refs resolvable.
grant usage on schema metering to authenticated, service_role;
-- governance: new domain schema (enum home for budget_period/enforcement/hold_status/
-- request_status; policy tables land in a later phase).
grant usage on schema governance to authenticated, service_role;
-- catalog: model/router/provider catalog + capability lookups. routers/providers/models/
-- model_endpoints/model_capabilities/capability_types moved here (§D); chains/overrides/provider_health
-- land in later catalog slices. Table SELECT grants for authenticated are bulk-granted in rework.sql.
grant usage on schema catalog to authenticated, service_role;
-- device: new domain schema (enum home for mcp_transport/mcp_scope/device_status;
-- mcp_servers + devices move here in a later phase).
grant usage on schema device to authenticated, service_role;
-- audit: new domain schema (enum home for alert_severity/channel_kind/operation;
-- alert_rules/alert_events/notification_channels + history.past_* move here in a later phase).
grant usage on schema audit to authenticated, service_role;
-- content: new domain schema (enum home for message_role/document_scope/asset_kind/space_role;
-- messages/documents/document_assets/space_members move here in a later phase).
grant usage on schema content to authenticated, service_role;
-- keyvault: new domain schema (enum home for credential_type/refresh_status; RENAMED from the
-- design's `vault` to avoid colliding with Supabase's built-in vault schema). router_credentials
-- moves here in a later phase. `authenticated` usage is for the future masked read view.
grant usage on schema keyvault to authenticated, service_role;

-- (1) Privileged tables — SELECT only. Writes are service_role via the gateway.
do $$
declare r record;
begin
  for r in select * from (values
    ('core',   'memberships'),
    ('core',   'roles'),
    ('core',   'role_permissions'),
    ('core',   'profile_roles'),
    ('core',   'tenant_languages'),
    ('catalog', 'chains'),
    ('catalog', 'chain_models'),
    ('public', 'spaces'),
    ('public', 'space_members'),
    ('public', 'budget_nodes'),
    ('governance', 'settings'),
    ('device', 'devices'),
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
grant select on core.permissions to authenticated;    -- global capability catalog
grant select on catalog.capability_types to authenticated;  -- model-capability lookup (moved config→catalog)

-- (4) audit_events: append-only — SELECT + INSERT (actor-bound, governance.sql);
-- UPDATE/DELETE are never granted to authenticated.
grant select, insert on audit.audit_events to authenticated;
revoke update, delete on audit.audit_events from authenticated;
