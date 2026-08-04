-- database/ddl/view/device/devices_for_tenant.ddl
set search_path to device, core, config, extensions;

-- §D §B shield view: the stable read contract for GET /v1/devices, decoupling it from the
-- public→device move. Joins core.profiles (owner display) + config.config_versions (tenant config
-- version). Gateway-internal read model — the caller's own-vs-`device.manage` filter is applied by
-- ledger.rs::get_devices as a WHERE on this view (profile_id/tenant_id), NOT baked in here.
create or replace view devices_for_tenant as
select
  d.tenant_id
, d.id
, d.profile_id
, d.name
, d.platform
, d.app_version
, d.config_version
, d.status
, d.enrolled_at
, d.last_seen_at
, d.sync_policy
, d.buffer_health
, p.display_name as owner
, cv.version     as tenant_config_version
from device.devices d
left join core.profiles p         on p.id = d.profile_id
left join config.config_versions cv on cv.tenant_id = d.tenant_id;

comment on view devices_for_tenant is
'Device fleet read shield (§D §B): device.devices × core.profiles (owner) × config.config_versions.
Backs GET /v1/devices; the gateway filters tenant_id + own-vs-device.manage. Isolates the devices
screen from the devices schema move.';
