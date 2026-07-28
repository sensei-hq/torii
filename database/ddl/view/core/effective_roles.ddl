-- database/ddl/view/core/effective_roles.ddl
set search_path to core, extensions;

-- RBAC resolution surface: a tenant's roles = the SHARED defaults (roles.tenant_id NULL, expanded
-- across every tenant so tenant_id is always concrete) UNION its own custom roles. Consumers filter
-- by tenant_id with no NULL handling. Default roles keep their single shared role_id across tenants.
create or replace view effective_roles as
  select t.id as tenant_id, r.id as role_id, r.key, r.name, r.is_system
    from core.roles r
    cross join core.tenants t
   where r.tenant_id is null
  union all
  select r.tenant_id, r.id as role_id, r.key, r.name, r.is_system
    from core.roles r
   where r.tenant_id is not null;

comment on view effective_roles is
'Per-tenant effective roles = shared defaults (roles.tenant_id NULL, cross-joined to every tenant)
UNION custom roles. Read this for role resolution/listing; write custom roles to core.roles.';
