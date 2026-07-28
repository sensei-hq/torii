set search_path to staging;

-- Staging for default-role grants → core.role_permissions (tenant_id NULL). Only the explicit
-- role→capability rows (editor/viewer/member/service). owner (all) + admin (all except
-- tenant.manage) are computed in the import proc so new capabilities auto-apply.
create table if not exists role_permissions (
  role_key    varchar not null
, capability  varchar not null
);

create unique index if not exists role_permissions_ukey on role_permissions(role_key, capability);
