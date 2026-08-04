-- database/ddl/table/public/devices.ddl
set search_path to public, core, device, extensions;

create table if not exists devices (
  tenant_id      uuid not null
    references core.tenants(id) on delete cascade
, id             uuid not null default gen_random_uuid()
, profile_id     uuid not null
, name           varchar(200)
, platform       varchar(50)
, public_key     text                     -- device key for per-device wrapping / revocation
, app_version    varchar(50)
, config_version bigint                    -- last synced config version (D4)
, sync_policy    jsonb not null default    -- O3-4 §3.4: D4 config-pull cadence + buffer flushing
    '{"config_pull":"realtime","pull_interval_s":300,"offline_grace_h":72,"buffer_flush":"on_reconnect"}'::jsonb
, buffer_health  jsonb                      -- D4-8 §3.3 offline buffer snapshot; O3-4 renders a fleet verdict (null until reported)
, status         device.device_status not null default 'active'
, enrolled_at    timestamptz not null default now()
, last_seen_at   timestamptz
, primary key (tenant_id, id)
);

create index if not exists idx_devices_profile on devices(tenant_id, profile_id);

comment on table devices is
'Enrolled desktop devices (F2 enrollment, D4 config sync, O3 fleet).
- public_key: per-device key for re-wrapping/revocation; config_version: last synced.
- sync_policy (O3-4): per-device D4 cadence, set via /rpc/devices/set-sync-policy (device.manage).
- buffer_health (D4-8): offline-buffer snapshot; O3-4 GET /v1/devices renders a health verdict.
- RLS (policies/governance.sql): a user sees own devices; owner/admin see all in-tenant.';
