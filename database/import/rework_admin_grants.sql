-- Reserve role.manage + apikey.manage to `owner` (M1). import_role_permissions only ADDS
-- (on conflict do nothing), so an admin default role provisioned before this change still
-- holds these two — delete them from the SHARED admin default (tenant_id NULL). Idempotent.
set search_path to core, extensions;

delete from core.role_permissions rp
  using core.roles r
 where rp.role_id = r.id
   and r.tenant_id is null
   and r.key = 'admin'
   and rp.tenant_id is null
   and rp.capability in ('role.manage', 'apikey.manage');
