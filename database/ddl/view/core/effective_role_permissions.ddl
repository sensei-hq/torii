-- database/ddl/view/core/effective_role_permissions.ddl
set search_path to core, extensions;

-- (role × capability) grants per tenant: shared default-role grants (role_permissions.tenant_id
-- NULL, expanded across every tenant) UNION custom-role grants. The C1 capability resolver reads
-- THIS (filtering `tenant_id = $1 and role_id = any($2)`), so default-role grants resolve for every
-- tenant while the resolver query itself stays unchanged.
create or replace view effective_role_permissions as
  select t.id as tenant_id, rp.role_id, rp.capability
    from core.role_permissions rp
    cross join core.tenants t
   where rp.tenant_id is null
  union all
  select rp.tenant_id, rp.role_id, rp.capability
    from core.role_permissions rp
   where rp.tenant_id is not null;

comment on view effective_role_permissions is
'Per-tenant effective (role × capability) grants = shared default-role grants (tenant_id NULL,
cross-joined to every tenant) UNION custom-role grants. The capability resolver reads this.';
