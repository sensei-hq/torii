-- database/ddl/table/core/profile_roles.ddl
set search_path to core, extensions;

-- RW2: user↔role assignment (tenant-scoped). Multiple roles per user ⇒ union.
create table if not exists profile_roles (
  tenant_id    uuid        not null references tenants(id) on delete cascade
, profile_id   uuid        not null references profiles(id) on delete cascade
, role_id      uuid        not null references roles(id) on delete cascade
, assigned_by  varchar     not null default 'system'
, assigned_at  timestamptz not null default now()
, primary key (tenant_id, profile_id, role_id)
);

create index if not exists idx_profile_roles_profile on profile_roles(profile_id);

comment on table profile_roles is
'User↔role assignment (tenant-scoped). A user may hold multiple roles; effective
capabilities are the UNION over role_permissions. Assign/unassign bumps the
target profile''s claims_version (the freshness gate).';
