set search_path to registry, config, core, extensions;

-- TM-6 (torii#24): a tenant's registry generation — the 'registry' component of
-- config.config_versions. 0 for a tenant that never published. Paused runs pin this; only a
-- registry publish moves it, so a catalog/routing edit never strands them.
create or replace function registry.generation(p_tenant uuid)
returns bigint
language sql
stable
as $$
  select coalesce(
    (select (components ->> 'registry')::bigint from config.config_versions where tenant_id = p_tenant),
    0);
$$;

revoke execute on function registry.generation(uuid) from public;
grant execute on function registry.generation(uuid) to service_role;

comment on function registry.generation is
'TM-6: the tenant''s registry generation (config_versions.components->registry, 0 if never published).';
