-- database/ddl/table/core/role_permissions.ddl
set search_path to core, extensions;

-- RW2: authoritative (role × capability) grant table, resolved server-side.
-- Default-role grants are SHARED (tenant_id NULL, referencing a tenant_id-NULL role); custom-role
-- grants are tenant-scoped. Resolution goes through core.effective_role_permissions (defaults
-- expanded per tenant + customs), never this base table directly.
create table if not exists role_permissions (
  tenant_id   uuid     references tenants(id) on delete cascade   -- NULL ⇒ shared default grant
, role_id     uuid     not null references roles(id) on delete cascade
, capability  varchar  not null references capabilities(key)
, primary key (role_id, capability)
);

create index if not exists idx_role_permissions_tenant on role_permissions(tenant_id);

comment on table role_permissions is
'Authoritative (role × capability) grants, resolved server-side (never trusted from the JWT).
Default-role grants are tenant_id NULL (shared); resolution via core.effective_role_permissions.
capability ∈ core.capabilities (F2 §4.3).';
