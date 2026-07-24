-- database/ddl/table/core/roles.ddl
set search_path to core, extensions;

-- RW2: per-tenant RBAC roles (replaces the removed profile_tenants.role enum).
create table if not exists roles (
  id          uuid        primary key default gen_random_uuid()
, tenant_id   uuid        not null references tenants(id) on delete cascade
, key         varchar     not null
, name        varchar     not null
, is_system   boolean     not null default false
, created_at  timestamptz not null default now()
, created_by  varchar     not null default 'system'
, unique (tenant_id, key)
);

create index if not exists idx_roles_tenant on roles(tenant_id);

comment on table roles is
'Per-tenant RBAC roles (decision #4 / RW2). Seeded system defaults
(owner/admin/editor/viewer/member/service) have is_system=true — undeletable,
display name renamable only. Custom roles allowed. Replaces the built
profile_tenants.role enum.';
