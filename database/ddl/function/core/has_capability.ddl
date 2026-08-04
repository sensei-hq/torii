-- database/ddl/function/core/has_capability.ddl
set search_path to core, extensions;

-- RW2: server-side capability resolution for RLS predicates and C1.
-- Resolves the current user's effective capabilities (UNION over their roles in
-- the active tenant) from profile_roles ⋈ effective_role_permissions — NEVER from
-- the JWT (the token carries only role_ids; capabilities are resolved here). SECURITY
-- DEFINER so it can read the RBAC tables under RLS. F2 §5.2 owns this contract.
--
-- MUST read core.effective_role_permissions (NOT role_permissions directly): default-role
-- grants are shared rows with tenant_id NULL ([[project-rbac-shared-defaults]]), so a direct
-- `rp.tenant_id = pt.tenant_id` join never matches them → every capability resolved false
-- (owner included). The effective view expands the NULL-tenant defaults across every tenant,
-- matching how the C1 Rust resolver already reads it.
create or replace function core.has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = core, extensions
as $$
  select exists (
    select 1
      from core.memberships              pt
      join core.profile_roles            pr  on pr.profile_id = pt.profile_id
                                            and pr.tenant_id  = pt.tenant_id
      join core.effective_role_permissions erp on erp.role_id   = pr.role_id
                                              and erp.tenant_id = pt.tenant_id
     where pt.profile_id = auth.uid()
       and pt.tenant_id  = (auth.jwt() ->> 'tenant_id')::uuid
       and pt.status     = 'active'
       and erp.capability = p_capability
  );
$$;

revoke execute on function core.has_capability(text) from public;
grant execute on function core.has_capability(text) to authenticated;
grant execute on function core.has_capability(text) to service_role;

comment on function core.has_capability(text) is
'RW2 (F2 §5.2): true iff the current user (auth.uid()) holds p_capability via any
role in their JWT active tenant. Resolves server-side from core.effective_role_permissions
(expands shared tenant_id-NULL default grants) — the token is never trusted for
capabilities. Used by RLS predicates (e.g. devices own-vs-manage) + C1.';
