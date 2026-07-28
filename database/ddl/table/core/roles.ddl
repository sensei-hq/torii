-- database/ddl/table/core/roles.ddl
set search_path to core, extensions;

-- RW2 / RBAC-defaults: RBAC roles. System defaults are SHARED — one static row per key with
-- tenant_id NULL (is_system=true); custom roles are tenant-scoped. Consumers resolve via the
-- core.effective_roles view (defaults expanded per tenant + customs), never this base table.
-- `nulls not distinct`: one default per key + one custom per (tenant,key); a custom role may not
-- reuse a default key (no shadowing) — enforced at the write path (rpc).
create table if not exists roles (
  id          uuid        primary key default gen_random_uuid()
, tenant_id   uuid        references tenants(id) on delete cascade   -- NULL ⇒ shared default
, key         varchar     not null
, name        varchar     not null
, is_system   boolean     not null default false
, created_at  timestamptz not null default now()
, created_by  varchar     not null default 'system'
, unique nulls not distinct (tenant_id, key)
);

create index if not exists idx_roles_tenant on roles(tenant_id);

comment on table roles is
'RBAC roles (decision #4 / RW2). System defaults (owner/admin/editor/viewer/member/service) are
SHARED: one row per key with tenant_id NULL, is_system=true — undeletable, name renamable only.
Custom roles are tenant-scoped. Resolution goes through core.effective_roles (defaults expanded
per tenant + customs). Replaces the built profile_tenants.role enum.';
