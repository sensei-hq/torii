-- database/ddl/enum/core/membership_status.ddl
set search_path to core;
-- db-redesign.md §3 shared core enum: core.profile_tenants.status (a profile's membership in a
-- tenant). Read ONLY via `status = 'active'` literal comparisons — in the two most security-
-- critical fns (custom_access_token_hook JWT minting + has_capability per-request authz) and
-- Rust exists() checks — all coerce over the enum. No writer sets it explicitly (default 'active').
create type membership_status as enum ('active', 'suspended');
