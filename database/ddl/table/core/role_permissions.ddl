-- database/ddl/table/core/role_permissions.ddl
set search_path to core, extensions;

-- RW2: authoritative (role × capability) grant table, resolved server-side.
create table if not exists role_permissions (
  tenant_id   uuid     not null references tenants(id) on delete cascade
, role_id     uuid     not null references roles(id) on delete cascade
, capability  varchar  not null references capabilities(key)
, primary key (role_id, capability)
);

create index if not exists idx_role_permissions_tenant on role_permissions(tenant_id);

comment on table role_permissions is
'Authoritative (role × capability) grants, resolved server-side by RLS helpers
and C1 (never trusted from the JWT). capability ∈ core.capabilities (F2 §4.3).';
