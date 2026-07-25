-- database/ddl/table/public/tenant_settings.ddl
set search_path to public, core, extensions;

-- W1: workspace-default policy toggles set on the admin Settings screen (PII masking,
-- automatic fallback, anomaly alerts, telemetry, …). Boolean-valued per (tenant, key);
-- an absent row falls back to the app default. Gateway-mediated: read via /v1/settings,
-- written via /rpc/settings/set.
create table if not exists tenant_settings (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, setting_key  varchar(60) not null
, enabled      boolean     not null default false
, modified_by  varchar     not null default 'system'
, modified_at  timestamptz not null default now()
, primary key (tenant_id, setting_key)
);

alter table tenant_settings enable row level security;
-- Own-tenant SELECT (policy in policies/rework.sql); writes via the gateway service_role.

comment on table tenant_settings is
'W1: workspace-default boolean policies per (tenant, setting_key). Absent = app default.
Service_role-write, own-tenant SELECT via RLS. Read /v1/settings, write /rpc/settings/set.';
