set search_path to config, core, extensions;

-- D4-1: bump a tenant's monotonic config_version + the touched component sub-version on any
-- config-affecting change (catalog/routing/budgets/features/settings/tools). Called by the
-- gateway (service_role) inside each /rpc/* config write. Returns the new version.
create or replace function config.bump_config_version(p_tenant uuid, p_component text)
returns bigint
language sql
as $$
  insert into config.config_versions (tenant_id, version, components, updated_at)
    values (p_tenant, 1, jsonb_build_object(p_component, 1), now())
  on conflict (tenant_id) do update set
    version = config.config_versions.version + 1,
    components = jsonb_set(
      config.config_versions.components,
      array[p_component],
      to_jsonb(coalesce((config.config_versions.components ->> p_component)::bigint, 0) + 1),
      true),
    updated_at = now()
  returning version;
$$;

-- Only the gateway (service_role) bumps; a leaked authenticated role must not.
revoke execute on function config.bump_config_version(uuid, text) from public;
grant execute on function config.bump_config_version(uuid, text) to service_role;

comment on function config.bump_config_version is
'D4-1: increments config_versions.version + the named component sub-version for a tenant
(catalog|routing|budgets|features|settings|tools). Called by C1 on every config /rpc write.';
