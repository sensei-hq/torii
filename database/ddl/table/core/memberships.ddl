-- database/ddl/table/core/memberships.ddl
set search_path to core, extensions;

-- §D core rename: profile_tenants → memberships (name-only; stays in core). The built
-- `role` enum is REMOVED (no authz reads it). This survives only as the user↔tenant
-- membership row; RBAC now lives in roles/role_permissions/profile_roles. `active` flags
-- the caller's active tenant for the JWT claim.
create table if not exists memberships (
  profile_id   uuid        primary key references profiles(id) on delete cascade
, tenant_id    uuid        not null references tenants(id) on delete restrict
, status       core.membership_status not null default 'active'
, active       boolean     not null default true
, assigned_at  timestamptz not null default now()
, assigned_by  varchar     not null
);

create index if not exists idx_memberships_tenant
  on memberships(tenant_id);

comment on table memberships is
'Maps user profiles to their tenant (one row per profile). RW2: the role enum is
REMOVED — RBAC is the roles/role_permissions/profile_roles matrix (decision #4).
- profile_id: FK core.profiles(id) (= auth.users.id)
- active: the caller''s active tenant (single-valued tenant_id JWT claim)
- assigned_by: ''domain_trigger'' when auto-assigned, else a user/service account';
