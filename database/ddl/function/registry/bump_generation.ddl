set search_path to registry, config, core, extensions;

-- TM-6 (torii#24): advance a tenant's registry generation, optionally compare-and-swap. Call it in
-- the same transaction as the replace-all write of registry.* so the definitions and the
-- generation move together. p_expected NULL = unconditional; otherwise returns NULL (and changes
-- nothing) when the current generation is not p_expected. Also advances the tenant's overall
-- config version via config.bump_config_version, so config snapshots see the publish.
create or replace function registry.bump_generation(p_tenant uuid, p_expected bigint default null)
returns bigint
language plpgsql
as $$
declare
  cur bigint;
begin
  -- Serialises publishers per tenant, including a tenant with no config_versions row yet
  -- (a row lock has nothing to lock there).
  perform pg_advisory_xact_lock(hashtextextended('registry.generation:' || p_tenant::text, 0));
  cur := registry.generation(p_tenant);
  if p_expected is not null and cur <> p_expected then
    return null;
  end if;
  perform config.bump_config_version(p_tenant, 'registry');
  return cur + 1;
end;
$$;

revoke execute on function registry.bump_generation(uuid, bigint) from public;
grant execute on function registry.bump_generation(uuid, bigint) to service_role;

comment on function registry.bump_generation is
'TM-6: CAS-advance the tenant''s registry generation (config_versions ''registry'' component).
Returns the new generation, or NULL when p_expected is stale.';
