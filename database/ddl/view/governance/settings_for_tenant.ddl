-- database/ddl/view/governance/settings_for_tenant.ddl
set search_path to governance, core, extensions;

-- §D §B shield view (Phase 4): the workspace-default boolean policy toggles as the stable
-- {setting_key, enabled} contract — preserving the shape the retired public.tenant_settings had, so
-- the masking / autoFallback enforcement gates, /v1/settings, and the config snapshot are byte-stable
-- across the tenant_settings→governance.settings absorb. Projects ONLY workspace-scope boolean
-- settings (space-scoped rows like the RAG retrieval config are jsonb objects, not toggles, and are
-- read directly by the gateway). Gateway-internal: read via the service_role pool, tenant-filtered;
-- NOT granted to authenticated (all-tenant rows, no security_invoker → a grant would be a PostgREST
-- cross-tenant leak).
create or replace view settings_for_tenant as
select
  tenant_id
, key                     as setting_key
, (value #>> '{}')::boolean as enabled
from governance.settings
where scope = 'workspace'
  and space_id is null
  and jsonb_typeof(value) = 'boolean';   -- only the boolean toggles (absorbed from tenant_settings)

comment on view settings_for_tenant is
'Workspace policy-toggle read shield (§D §B, Phase 4): governance.settings scope=workspace boolean
rows projected as {setting_key, enabled}, preserving the retired tenant_settings contract. Backs the
masking/autoFallback gates, /v1/settings, and the config snapshot. Gateway-internal; never grant to
authenticated.';
