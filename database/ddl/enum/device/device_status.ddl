-- database/ddl/enum/device/device_status.ddl
set search_path to device;
-- db-redesign.md §3 device enum: devices.status. The revoked-device hot-path denial
-- (auth.rs finish_authed `status = 'active'`) is a literal comparison → coerces, unchanged.
-- revoke_device SETs literal 'revoked'; get_devices reads via json_agg. No Rust cast.
create type device_status as enum ('active', 'revoked');
