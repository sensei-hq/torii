-- §D schema-move regression guard — asserts each completed table MOVE landed in its target
-- schema, its append-only/RLS invariants survived, and its shield read-view exists.
\set ON_ERROR_STOP on
\echo '== §D moves: audit.audit_events =='

-- M-audit-1 — audit_events lives in `audit` (moved out of public), and public has no leftover.
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='audit' and c.relname='audit_events' and c.relkind='r') then
    raise exception 'FAIL: audit.audit_events table missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='audit_events') then
    raise exception 'FAIL: public.audit_events still exists (move incomplete)'; end if;
  raise notice 'M-audit-1 audit_events relocated public→audit ✓';
end $$;

-- M-audit-2 — append-only trigger + RLS survived the move (tamper-evidence intact).
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid='audit.audit_events'::regclass
                  and tgname='audit_events_append_only' and not tgisinternal) then
    raise exception 'FAIL: append-only trigger lost from audit.audit_events'; end if;
  if not (select relrowsecurity from pg_class where oid='audit.audit_events'::regclass) then
    raise exception 'FAIL: RLS disabled on audit.audit_events after move'; end if;
  if not exists (select 1 from pg_policies where schemaname='audit' and tablename='audit_events'
                  and policyname='audit_events_insert') then
    raise exception 'FAIL: audit_events_insert policy lost'; end if;
  raise notice 'M-audit-2 append-only trigger + RLS + insert policy intact ✓';
end $$;

-- M-audit-3 — the shield view exists with the AuditEvent contract columns.
do $$
declare missing text;
begin
  if not exists (select 1 from pg_views where schemaname='audit' and viewname='audit_events_for_tenant') then
    raise exception 'FAIL: audit.audit_events_for_tenant view missing'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','id','actor_id','actor','action','target_type','target_id','ip','created_at']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='audit' and table_name='audit_events_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: shield view missing columns: %', missing; end if;
  raise notice 'M-audit-3 audit_events_for_tenant shield view + contract ✓';
end $$;

-- M-audit-4 — notification_channels + siem_cursors relocated public→audit; invariants intact.
do $$
declare t text;
begin
  foreach t in array array['notification_channels','siem_cursors'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='audit' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: audit.% table missing', t; end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relname=t) then
      raise exception 'FAIL: public.% still exists (move incomplete)', t; end if;
    if not (select relrowsecurity from pg_class where oid=('audit.'||t)::regclass) then
      raise exception 'FAIL: RLS disabled on audit.% after move', t; end if;
  end loop;
  -- notification_channels keeps its tenant read policy; siem_cursors is deny-all (RLS, 0 policies).
  if not exists (select 1 from pg_policies where schemaname='audit' and tablename='notification_channels'
                  and policyname='notification_channels_read') then
    raise exception 'FAIL: notification_channels_read policy lost'; end if;
  if exists (select 1 from pg_policies where schemaname='audit' and tablename='siem_cursors') then
    raise exception 'FAIL: siem_cursors should be deny-all (no policy)'; end if;
  raise notice 'M-audit-4 notification_channels + siem_cursors relocated, RLS/policy posture intact ✓';
end $$;

\echo '== §D moves: device.devices =='

-- M-device-1 — devices relocated public→device; the own-vs-manage RLS survived (security-critical).
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='device' and c.relname='devices' and c.relkind='r') then
    raise exception 'FAIL: device.devices table missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='devices') then
    raise exception 'FAIL: public.devices still exists (move incomplete)'; end if;
  if not (select relrowsecurity from pg_class where oid='device.devices'::regclass) then
    raise exception 'FAIL: RLS disabled on device.devices after move'; end if;
  -- devices_access must be the SOLE select policy (no permissive devices_read that leaks the fleet).
  if not exists (select 1 from pg_policies where schemaname='device' and tablename='devices'
                  and policyname='devices_access') then
    raise exception 'FAIL: devices_access policy lost'; end if;
  if exists (select 1 from pg_policies where schemaname='device' and tablename='devices'
              and policyname='devices_read') then
    raise exception 'FAIL: a permissive devices_read policy reappeared (fleet leak)'; end if;
  raise notice 'M-device-1 devices relocated public→device, own-vs-manage RLS is sole policy ✓';
end $$;

-- M-device-2 — devices_for_tenant shield view exists with the fleet contract.
do $$
declare missing text;
begin
  if not exists (select 1 from pg_views where schemaname='device' and viewname='devices_for_tenant') then
    raise exception 'FAIL: device.devices_for_tenant view missing'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','id','profile_id','name','platform','app_version','config_version','status',
    'enrolled_at','last_seen_at','sync_policy','buffer_health','owner','tenant_config_version']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='device' and table_name='devices_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: devices_for_tenant missing columns: %', missing; end if;
  raise notice 'M-device-2 devices_for_tenant shield view + fleet contract ✓';
end $$;

-- M-device-3 — the 4 MCP registry tables relocated public→device; RLS + tool_allowed intact.
do $$
declare t text;
begin
  foreach t in array array['mcp_servers','mcp_server_tools','tenant_mcp_servers','tool_allow_lists'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='device' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: device.% table missing', t; end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relname=t) then
      raise exception 'FAIL: public.% still exists (move incomplete)', t; end if;
    if not exists (select 1 from pg_policies where schemaname='device' and tablename=t) then
      raise exception 'FAIL: device.% lost its RLS policy', t; end if;
  end loop;
  -- the X1 default-deny fn now resolves against device.tool_allow_lists.
  if pg_get_functiondef('public.tool_allowed'::regproc) !~ 'device\.tool_allow_lists' then
    raise exception 'FAIL: tool_allowed() not repointed to device.tool_allow_lists'; end if;
  raise notice 'M-device-3 4 MCP tables relocated public→device, RLS + tool_allowed intact ✓';
end $$;

\echo '== §D moves: core.{api_keys,service_accounts} (access fold) =='

-- M-core-1 — api_keys + service_accounts relocated public→core (§8 access fold); FK + RLS intact.
do $$
declare t text;
begin
  foreach t in array array['api_keys','service_accounts'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='core' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: core.% table missing', t; end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relname=t) then
      raise exception 'FAIL: public.% still exists (move incomplete)', t; end if;
    if not exists (select 1 from pg_policies where schemaname='core' and tablename=t) then
      raise exception 'FAIL: core.% lost its RLS policy', t; end if;
  end loop;
  -- the api_keys→service_accounts FK must survive the co-move.
  if not exists (select 1 from pg_constraint where conrelid='core.api_keys'::regclass
                  and confrelid='core.service_accounts'::regclass and contype='f') then
    raise exception 'FAIL: api_keys→service_accounts FK lost'; end if;
  raise notice 'M-core-1 api_keys + service_accounts relocated public→core, FK + RLS intact ✓';
end $$;

-- M-core-2 — apikeys_for_tenant shield view exists and NEVER exposes the secret.
do $$
declare missing text;
begin
  if not exists (select 1 from pg_views where schemaname='core' and viewname='apikeys_for_tenant') then
    raise exception 'FAIL: core.apikeys_for_tenant view missing'; end if;
  if exists (select 1 from information_schema.columns
              where table_schema='core' and table_name='apikeys_for_tenant' and column_name='hashed_secret') then
    raise exception 'FAIL: apikeys_for_tenant LEAKS hashed_secret'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','id','prefix','profile_id','service_account_id','scope','status','last_used_at','created_at']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='core' and table_name='apikeys_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: apikeys_for_tenant missing columns: %', missing; end if;
  raise notice 'M-core-2 apikeys_for_tenant shield view (no secret) + contract ✓';
end $$;

\echo '== §D core rename: core.memberships =='

-- M-core-3 — profile_tenants renamed → core.memberships (name-only, stays in core); the
-- membership_status enum + RLS survived, and NO orphan old-name policy lingers. No shield view:
-- memberships has zero external readers (auth fns + service_role gateway only), so nothing to shield.
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='core' and c.relname='memberships' and c.relkind='r') then
    raise exception 'FAIL: core.memberships table missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='core' and c.relname='profile_tenants') then
    raise exception 'FAIL: core.profile_tenants still exists (rename incomplete)'; end if;
  if not (select relrowsecurity from pg_class where oid='core.memberships'::regclass) then
    raise exception 'FAIL: RLS disabled on core.memberships after rename'; end if;
  -- status is still the membership_status enum — the JWT hook + has_capability `= 'active'` depend on it.
  if (select udt_name from information_schema.columns
        where table_schema='core' and table_name='memberships' and column_name='status')
     is distinct from 'membership_status' then
    raise exception 'FAIL: core.memberships.status is not the membership_status enum'; end if;
  -- the carried-over old-name policies must be gone; only the memberships_* policies remain. A lingering
  -- profile_tenants_read/_auth_admin would double-cover the table (the rename orphan-policy footgun).
  if exists (select 1 from pg_policies where schemaname='core' and tablename='memberships'
              and policyname in ('profile_tenants_read','profile_tenants_auth_admin')) then
    raise exception 'FAIL: orphan profile_tenants_* policy lingers on core.memberships'; end if;
  if not exists (select 1 from pg_policies where schemaname='core' and tablename='memberships'
                  and policyname='memberships_read') then
    raise exception 'FAIL: memberships_read policy missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='core' and tablename='memberships'
                  and policyname='memberships_auth_admin') then
    raise exception 'FAIL: memberships_auth_admin policy missing'; end if;
  raise notice 'M-core-3 profile_tenants→core.memberships renamed, enum+RLS intact, no orphan policy ✓';
end $$;

\echo '== §D core rename: core.permissions =='

-- M-core-4 — capabilities renamed → core.permissions (name-only, stays in core); role_permissions
-- FK still resolves + no orphan capabilities_read policy lingers (only permissions_read). Column
-- names (role_permissions.capability, the has_capability fn) are intentionally UNCHANGED per design.
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='core' and c.relname='permissions' and c.relkind='r') then
    raise exception 'FAIL: core.permissions table missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='core' and c.relname='capabilities') then
    raise exception 'FAIL: core.capabilities still exists (rename incomplete)'; end if;
  if not (select relrowsecurity from pg_class where oid='core.permissions'::regclass) then
    raise exception 'FAIL: RLS disabled on core.permissions after rename'; end if;
  -- role_permissions.capability FK must still point at core.permissions (constraint identity survived).
  if not exists (select 1 from pg_constraint where conrelid='core.role_permissions'::regclass
                  and confrelid='core.permissions'::regclass and contype='f') then
    raise exception 'FAIL: role_permissions→permissions FK lost/mis-targeted'; end if;
  -- policy: permissions_read present, the carried-over capabilities_read orphan gone.
  if exists (select 1 from pg_policies where schemaname='core' and tablename='permissions'
              and policyname='capabilities_read') then
    raise exception 'FAIL: orphan capabilities_read policy lingers on core.permissions'; end if;
  if not exists (select 1 from pg_policies where schemaname='core' and tablename='permissions'
                  and policyname='permissions_read') then
    raise exception 'FAIL: permissions_read policy missing'; end if;
  raise notice 'M-core-4 capabilities→core.permissions renamed, role_permissions FK + RLS intact, no orphan policy ✓';
end $$;

\echo '== §D catalog rename+move: catalog.capability_types =='

-- M-catalog-1 — config.capabilities MOVED+RENAMED → catalog.capability_types (model-capability
-- lookup). The model_capabilities/model_endpoints/fallback_chains capability_id FKs still resolve
-- to it, and authenticated keeps SELECT (global reference catalog). Column names kept.
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='catalog' and c.relname='capability_types' and c.relkind='r') then
    raise exception 'FAIL: catalog.capability_types table missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='config' and c.relname='capabilities') then
    raise exception 'FAIL: config.capabilities still exists (move incomplete)'; end if;
  -- all three capability_id FKs must target catalog.capability_types (constraint identity survived).
  if (select count(*) from pg_constraint
        where confrelid='catalog.capability_types'::regclass and contype='f'
          and conrelid in ('catalog.model_capabilities'::regclass,
                           'catalog.model_endpoints'::regclass,
                           'catalog.chains'::regclass)) <> 3 then
    raise exception 'FAIL: not all 3 capability_id FKs resolve to catalog.capability_types'; end if;
  -- authenticated keeps SELECT on the reference catalog (carried by SET SCHEMA + grants.sql parity).
  if not has_table_privilege('authenticated','catalog.capability_types','select') then
    raise exception 'FAIL: authenticated lost SELECT on catalog.capability_types'; end if;
  raise notice 'M-catalog-1 config.capabilities→catalog.capability_types moved+renamed, 3 FKs + grant intact ✓';
end $$;

\echo '== §D catalog moves: model catalog cluster (routers/providers/models/model_capabilities/model_endpoints) =='

-- M-catalog-2 — the 5 model-catalog tables MOVED config→catalog (db-redesign.md §37). Names unchanged;
-- global reference data (no tenant_id, RLS off). Intra-cluster + inbound FKs still resolve, and
-- authenticated keeps SELECT (carried by SET SCHEMA + rework.sql catalog bulk grant).
do $$
declare t text;
begin
  foreach t in array array['routers','providers','models','model_capabilities','model_endpoints'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='catalog' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: catalog.% table missing', t; end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='config' and c.relname=t) then
      raise exception 'FAIL: config.% still exists (move incomplete)', t; end if;
    if not has_table_privilege('authenticated', ('catalog.'||t)::regclass, 'select') then
      raise exception 'FAIL: authenticated lost SELECT on catalog.%', t; end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid='catalog.models'::regclass
                  and confrelid='catalog.providers'::regclass and contype='f') then
    raise exception 'FAIL: catalog.models→catalog.providers FK lost'; end if;
  if not exists (select 1 from pg_constraint where conrelid='catalog.model_endpoints'::regclass
                  and confrelid='catalog.routers'::regclass and contype='f') then
    raise exception 'FAIL: catalog.model_endpoints→catalog.routers FK lost'; end if;
  if not exists (select 1 from pg_constraint where conrelid='catalog.chain_models'::regclass
                  and confrelid='catalog.models'::regclass and contype='f') then
    raise exception 'FAIL: catalog.chain_models→catalog.models FK lost'; end if;
  raise notice 'M-catalog-2 model catalog (routers/providers/models/model_capabilities/model_endpoints) moved config→catalog, FKs + grants intact ✓';
end $$;

\echo '== §D catalog rename+move: routing (chains/chain_models/chain_bindings/routing_policies) =='

-- M-catalog-3 — public routing tables → catalog: fallback_chains→chains + fallback_chain_models→
-- chain_models (RENAME+move), chain_bindings + routing_policies (move). Tenant-scoped: RLS survives,
-- the carried-over fallback_chains_read/fallback_chain_models_read orphans are dropped (only
-- chains_read/chain_models_read remain), and the composite chain FKs resolve to catalog.chains.
do $$
declare t text;
begin
  foreach t in array array['chains','chain_models','chain_bindings','routing_policies'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='catalog' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: catalog.% table missing', t; end if;
    if not (select relrowsecurity from pg_class where oid=('catalog.'||t)::regclass) then
      raise exception 'FAIL: RLS disabled on catalog.% after move', t; end if;
  end loop;
  foreach t in array array['fallback_chains','fallback_chain_models','chain_bindings','routing_policies'] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relname=t) then
      raise exception 'FAIL: public.% still exists (move incomplete)', t; end if;
  end loop;
  -- carried-over old-name read policies from the RENAMEs must be gone (orphan-policy footgun).
  if exists (select 1 from pg_policies where schemaname='catalog'
              and policyname in ('fallback_chains_read','fallback_chain_models_read')) then
    raise exception 'FAIL: orphan fallback_chains_read/fallback_chain_models_read lingers on catalog'; end if;
  if not exists (select 1 from pg_policies where schemaname='catalog' and tablename='chains' and policyname='chains_read') then
    raise exception 'FAIL: chains_read policy missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='catalog' and tablename='chain_models' and policyname='chain_models_read') then
    raise exception 'FAIL: chain_models_read policy missing'; end if;
  -- composite FKs (chain_models/chain_bindings/routing_policies) all resolve to catalog.chains.
  if (select count(*) from pg_constraint where confrelid='catalog.chains'::regclass and contype='f'
        and conrelid in ('catalog.chain_models'::regclass,'catalog.chain_bindings'::regclass,
                         'catalog.routing_policies'::regclass)) <> 3 then
    raise exception 'FAIL: not all 3 composite FKs resolve to catalog.chains'; end if;
  raise notice 'M-catalog-3 routing tables → catalog (2 renames + 2 moves), RLS + FKs + no orphan policy ✓';
end $$;

\echo '== §D catalog moves: overrides + provider_health =='

-- M-catalog-4 — provider_overrides + provider_health MOVED public→catalog (move only; model_overrides
-- was also moved here in Phase 1 but is now RETIRED in Phase 3). Tenant-scoped (tenant_id + RLS); FKs
-- to catalog.models/providers already intra-schema; the _read policies carry by name (no orphan).
-- Enum state=breaker_state survives (override_scope was dropped with model_overrides).
do $$
declare t text;
begin
  -- model_overrides was moved here in Phase 1 but RETIRED in Phase 3 (enablement derives from
  -- chains_for_tenant); only provider_overrides + provider_health remain as moved tables.
  foreach t in array array['provider_overrides','provider_health'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='catalog' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: catalog.% table missing', t; end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relname=t) then
      raise exception 'FAIL: public.% still exists (move incomplete)', t; end if;
    if not (select relrowsecurity from pg_class where oid=('catalog.'||t)::regclass) then
      raise exception 'FAIL: RLS disabled on catalog.% after move', t; end if;
    if not exists (select 1 from pg_policies where schemaname='catalog' and tablename=t and policyname=t||'_read') then
      raise exception 'FAIL: catalog.%._read policy lost', t; end if;
  end loop;
  -- model_overrides must be GONE (Phase 3 drop).
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='catalog' and c.relname='model_overrides') then
    raise exception 'FAIL: catalog.model_overrides still exists (Phase 3 retirement incomplete)'; end if;
  raise notice 'M-catalog-4 provider_overrides/provider_health moved public→catalog (model_overrides retired) ✓';
end $$;

\echo '== §D Phase 2 secret custody: keyvault.{router_credentials,tenant_keys,tenant_key_archive} + shield =='

-- M-keyvault-1 — the ★ top shield (Slice A shipped it BEFORE the move so Connections never observed
-- the table sliding into keyvault). It must exist in keyvault with the exact Connections contract,
-- expose NO ciphertext, and — since it carries every tenant's rows with no security_invoker — must
-- NOT be granted to authenticated (a grant would be a PostgREST cross-tenant leak).
do $$
declare missing text;
begin
  if not exists (select 1 from pg_views where schemaname='keyvault' and viewname='connections_for_tenant') then
    raise exception 'FAIL: keyvault.connections_for_tenant view missing'; end if;
  -- ciphertext must be structurally absent from the projection.
  if exists (select 1 from information_schema.columns
              where table_schema='keyvault' and table_name='connections_for_tenant'
                and column_name in ('encrypted_api_key','encrypted_oauth','encrypted_dek')) then
    raise exception 'FAIL: connections_for_tenant LEAKS a ciphertext column'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','name','api_base_url','is_active','requires_key',
    'connected','connected_at','oauth_connected','oauth_connected_at']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='keyvault' and table_name='connections_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: connections_for_tenant missing columns: %', missing; end if;
  -- deny-all discipline: gateway-internal, never exposed to authenticated/anon.
  if has_table_privilege('authenticated','keyvault.connections_for_tenant','select') then
    raise exception 'FAIL: authenticated can SELECT connections_for_tenant (cross-tenant leak)'; end if;
  if has_table_privilege('anon','keyvault.connections_for_tenant','select') then
    raise exception 'FAIL: anon can SELECT connections_for_tenant'; end if;
  raise notice 'M-keyvault-1 connections_for_tenant shield (no ciphertext, deny-all) + contract ✓';
end $$;

-- M-keyvault-2 — Slice B: the 3 secret tables relocated into keyvault (router_credentials ← public,
-- tenant_keys + tenant_key_archive ← core). Each must keep the deny-all posture (RLS on + 0 policies
-- = service_role-only), the router_credentials → tenants/routers FKs must survive the move, and the
-- shield view must now read keyvault.router_credentials.
do $$
declare t text; src text;
begin
  foreach t in array array['router_credentials','tenant_keys','tenant_key_archive'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='keyvault' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: keyvault.% table missing', t; end if;
    -- gone from BOTH old homes (router_credentials was public; the key tables were core).
    foreach src in array array['public','core'] loop
      if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname=src and c.relname=t) then
        raise exception 'FAIL: %.% still exists (move incomplete)', src, t; end if;
    end loop;
    if not (select relrowsecurity from pg_class where oid=('keyvault.'||t)::regclass) then
      raise exception 'FAIL: RLS disabled on keyvault.% after move', t; end if;
    -- deny-all: RLS on with ZERO policies (service_role bypasses RLS; clients get nothing).
    if exists (select 1 from pg_policies where schemaname='keyvault' and tablename=t) then
      raise exception 'FAIL: keyvault.% must be deny-all (0 policies), found one', t; end if;
    -- and authenticated/anon hold no table privilege on the secret.
    if has_table_privilege('authenticated', ('keyvault.'||t)::regclass, 'select') then
      raise exception 'FAIL: authenticated can SELECT keyvault.% (secret leak)', t; end if;
  end loop;
  -- router_credentials FKs survived SET SCHEMA (identity by OID, but assert they still resolve).
  if not exists (select 1 from pg_constraint where conrelid='keyvault.router_credentials'::regclass
                  and confrelid='core.tenants'::regclass and contype='f') then
    raise exception 'FAIL: keyvault.router_credentials → core.tenants FK lost'; end if;
  if not exists (select 1 from pg_constraint where conrelid='keyvault.router_credentials'::regclass
                  and confrelid='catalog.routers'::regclass and contype='f') then
    raise exception 'FAIL: keyvault.router_credentials → catalog.routers FK lost'; end if;
  -- the shield view now reads the relocated table.
  if pg_get_viewdef('keyvault.connections_for_tenant'::regclass) !~ 'keyvault\.router_credentials' then
    raise exception 'FAIL: connections_for_tenant not repointed to keyvault.router_credentials'; end if;
  raise notice 'M-keyvault-2 3 secret tables relocated → keyvault, deny-all + FKs intact, shield repointed ✓';
end $$;

\echo '== §D Phase 3: catalog.chains_for_tenant (enablement + viability + pricing shield) =='

-- M-catalog-5 — chains_for_tenant is the derived enablement/pricing shield that replaces
-- model_overrides/tenant_model_state. Assert: (1) it exists with the enablement+pricing contract;
-- (2) the KEYLESS-SAFE guard — a local (authentication_type='none') router's models appear WITHOUT
-- any credential, while a key-requiring router with NO active credential is scrubbed; (3) not
-- granted to authenticated (gateway-internal, cross-tenant rows).
do $$
declare missing text; kless int; keyed int; leaked int;
begin
  if not exists (select 1 from pg_views where schemaname='catalog' and viewname='chains_for_tenant') then
    raise exception 'FAIL: catalog.chains_for_tenant view missing'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','chain_name','capability_id','model_id','model_full_name','router_id','router_name',
    'router_requires_key','provider','cost_per_input_token','cost_per_output_token']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='catalog' and table_name='chains_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: chains_for_tenant missing columns: %', missing; end if;

  -- Keyless-safe guard (empirical): with NO tenant credentials on dev, only keyless-local routers
  -- (authentication_type='none') may appear; a key-requiring router must be fully scrubbed.
  select count(*) into kless from catalog.chains_for_tenant where router_requires_key = false;
  select count(*) into keyed from catalog.chains_for_tenant cft
    where cft.router_requires_key = true
      and not exists (select 1 from keyvault.router_credentials rc
                       where rc.tenant_id = cft.tenant_id and rc.router_id = cft.router_id
                         and rc.is_active = true);
  if keyed <> 0 then
    raise exception 'FAIL: chains_for_tenant surfaced % key-requiring step(s) with no active credential (viability guard broken)', keyed; end if;
  if kless = 0 then
    raise notice 'M-catalog-5 NOTE: 0 keyless-local rows present (no local chain seeded) — guard vacuously holds';
  end if;

  -- Gateway-internal: authenticated must NOT be able to read it (cross-tenant leak otherwise).
  -- NB: this ambient state is correct only AFTER policies/rework.sql is applied (run.sh order) —
  -- rework.sql's `grant select on all tables in schema catalog` sweeps in views, so the shield
  -- depends on the explicit `revoke ... chains_for_tenant` carve-out right after that grant.
  if has_table_privilege('authenticated','catalog.chains_for_tenant','select') then
    raise exception 'FAIL: authenticated can SELECT chains_for_tenant (cross-tenant leak)'; end if;
  raise notice 'M-catalog-5 chains_for_tenant shield: contract + keyless-safe viability (keyless=%, key-no-cred scrubbed) + deny-all ✓', kless;
end $$;

-- M-catalog-5b — NON-VACUOUS regression guard for the blanket-grant sweep (the leak the
-- dbd-pattern-verifier caught). Proves, in a rolled-back subtransaction: (1) the catalog blanket
-- grant DOES reach this view (so M-catalog-5's deny-all is not free), and (2) the revoke carve-out
-- re-closes it. If someone drops the revoke from rework.sql, the harness (policies→tests) trips
-- M-catalog-5; this block independently proves the mechanism.
do $$
begin
  begin  -- subtransaction: the raise at the end rolls back the grant/revoke below
    grant select on all tables in schema catalog to authenticated;
    if not has_table_privilege('authenticated','catalog.chains_for_tenant','select') then
      raise exception 'FAIL(vacuous): the catalog blanket grant did NOT reach chains_for_tenant — test assumption stale'; end if;
    revoke select on catalog.chains_for_tenant from authenticated;
    if has_table_privilege('authenticated','catalog.chains_for_tenant','select') then
      raise exception 'FAIL: revoke carve-out does not re-close the shield after the blanket grant'; end if;
    raise exception 'rollback_ok';  -- undo the grant/revoke (no privilege state leaks out)
  exception
    when others then
      if sqlerrm <> 'rollback_ok' then raise; end if;  -- re-raise real failures
  end;
  raise notice 'M-catalog-5b blanket catalog grant reaches the view; the revoke carve-out re-closes it ✓';
end $$;

-- M-catalog-6 — the chat enablement GATE derivation (chat.rs ensure_model_enabled) and the
-- /v1/models/available derivation both resolve through chains_for_tenant. Assert the exact gate
-- predicate: a model present in the platform tenant's viable CHAT chains is ALLOWED, and a bogus
-- model name is BLOCKED (the security property — a non-chain model is not callable).
do $$
declare pt uuid := '00000000-0000-0000-0000-000000000000';
        a_chat_model text; allowed boolean; bogus_allowed boolean;
begin
  -- a model that is in a viable chat chain for the platform tenant (skip if none seeded)
  select cft.model_full_name into a_chat_model
    from catalog.chains_for_tenant cft
    join catalog.capability_types c on c.id = cft.capability_id
   where cft.tenant_id = pt and c.name = 'chat'
   limit 1;
  if a_chat_model is null then
    raise notice 'M-catalog-6 NOTE: no viable chat-chain model for platform tenant — gate assertion skipped';
  else
    -- exact gate SQL from chat.rs::ensure_model_enabled
    select exists(select 1 from catalog.chains_for_tenant cft
                    join catalog.capability_types c on c.id = cft.capability_id
                   where cft.tenant_id = pt and cft.model_full_name = a_chat_model and c.name = 'chat')
      into allowed;
    if not allowed then raise exception 'FAIL: in-chain chat model % blocked by the gate', a_chat_model; end if;
  end if;
  -- a model NOT in any chain must be blocked (default-deny; absent = enabled is RETIRED).
  select exists(select 1 from catalog.chains_for_tenant cft
                  join catalog.capability_types c on c.id = cft.capability_id
                 where cft.tenant_id = pt and cft.model_full_name = '__no_such_model__' and c.name = 'chat')
    into bogus_allowed;
  if bogus_allowed then raise exception 'FAIL: a non-chain model passed the enablement gate (default-deny broken)'; end if;
  raise notice 'M-catalog-6 enablement gate derives from chains_for_tenant: in-chat-chain allowed, non-chain blocked ✓';
end $$;

\echo '== §D Phase 4: governance features move + feature_key→feature_id fold =='

-- M-gov-1 — config.features + config.modules relocated → governance (lookups; rich UI columns kept),
-- public.feature_policies relocated → governance, and config.feature_states RETIRED. The lookups keep
-- authenticated SELECT (grant parity); feature_policies keeps RLS + its tenant read policy.
do $$
declare t text;
begin
  foreach t in array array['features','modules','feature_policies'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='governance' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: governance.% table missing', t; end if;
  end loop;
  -- gone from the old homes.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='config' and c.relname in ('features','modules','feature_states')) then
    raise exception 'FAIL: a config.{features,modules,feature_states} table still exists'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='feature_policies') then
    raise exception 'FAIL: public.feature_policies still exists'; end if;
  -- lookups readable by authenticated (parity); feature_policies is tenant-scoped RLS.
  if not has_table_privilege('authenticated','governance.features','select') then
    raise exception 'FAIL: authenticated lost SELECT on governance.features'; end if;
  if not (select relrowsecurity from pg_class where oid='governance.feature_policies'::regclass) then
    raise exception 'FAIL: RLS disabled on governance.feature_policies'; end if;
  if not exists (select 1 from pg_policies where schemaname='governance' and tablename='feature_policies'
                  and policyname='feature_policies_read') then
    raise exception 'FAIL: feature_policies_read policy missing'; end if;
  raise notice 'M-gov-1 features/modules/feature_policies → governance, feature_states retired, grants+RLS intact ✓';
end $$;

-- M-gov-2 — the feature_key→feature_id FOLD: feature_policies is keyed by a uuid FK→governance.features
-- (feature_key column gone), with a global unique(slug) on features so slug→id is unambiguous.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='governance' and table_name='feature_policies' and column_name='feature_key') then
    raise exception 'FAIL: feature_policies.feature_key still exists (fold incomplete)'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='governance' and table_name='feature_policies' and column_name='feature_id') then
    raise exception 'FAIL: feature_policies.feature_id missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='governance.feature_policies'::regclass
                  and confrelid='governance.features'::regclass and contype='f') then
    raise exception 'FAIL: feature_policies.feature_id → governance.features FK missing'; end if;
  -- global slug uniqueness (enables the slug→id resolution writers rely on).
  if not exists (select 1 from pg_indexes where schemaname='governance' and tablename='features'
                  and indexname='features_slug_ukey') then
    raise exception 'FAIL: governance.features global slug unique index missing'; end if;
  raise notice 'M-gov-2 feature_key→feature_id fold: uuid FK + global slug unique, feature_key dropped ✓';
end $$;

-- M-gov-3 — the feature_governance_for_tenant shield exists, exposes slug over the fold, and is
-- gateway-internal (NOT granted to authenticated — all-tenant rows, no security_invoker).
do $$
declare missing text;
begin
  if not exists (select 1 from pg_views where schemaname='governance' and viewname='feature_governance_for_tenant') then
    raise exception 'FAIL: governance.feature_governance_for_tenant view missing'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','feature_id','slug','title','enabled','mandatory','sequence','policy_state']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='governance' and table_name='feature_governance_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: shield missing columns: %', missing; end if;
  if has_table_privilege('authenticated','governance.feature_governance_for_tenant','select') then
    raise exception 'FAIL: authenticated can SELECT feature_governance_for_tenant (cross-tenant leak)'; end if;
  raise notice 'M-gov-3 feature_governance_for_tenant shield: slug contract + deny-all ✓';
end $$;

-- M-gov-4 — Slice B: public.settings relocated → governance, and public.tenant_settings ABSORBED
-- into it (boolean toggles → scope='workspace' jsonb) then retired. The settings_for_tenant shield
-- preserves the {setting_key, enabled} contract and is gateway-internal (deny-all).
do $$
declare missing text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='governance' and c.relname='settings' and c.relkind='r') then
    raise exception 'FAIL: governance.settings missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname in ('settings','tenant_settings')) then
    raise exception 'FAIL: public.settings/tenant_settings still exists'; end if;
  if not (select relrowsecurity from pg_class where oid='governance.settings'::regclass) then
    raise exception 'FAIL: RLS disabled on governance.settings'; end if;
  -- shield exists with the toggle contract, deny-all.
  if not exists (select 1 from pg_views where schemaname='governance' and viewname='settings_for_tenant') then
    raise exception 'FAIL: settings_for_tenant view missing'; end if;
  select string_agg(c, ', ') into missing from unnest(array['tenant_id','setting_key','enabled']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='governance' and table_name='settings_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: settings_for_tenant missing columns: %', missing; end if;
  if has_table_privilege('authenticated','governance.settings_for_tenant','select') then
    raise exception 'FAIL: authenticated can SELECT settings_for_tenant (cross-tenant leak)'; end if;
  -- the absorb round-trips: a workspace boolean written to settings surfaces via the shield.
  perform 1;  -- (0 rows on dev; behavioral round-trip proven by the gateway settings_set test)
  raise notice 'M-gov-4 settings → governance + tenant_settings absorbed/retired, settings_for_tenant shield deny-all ✓';
end $$;

\echo '== §D Phase 5: org/budget split — budget shields (S1) =='

-- M-org-1 — budget_tree_for_tenant shield exists with the flat BudgetNode contract and is
-- gateway-internal (NOT granted to authenticated — all-tenant rows, no security_invoker). Shipped
-- BEFORE the budget_nodes→governance.nodes move so /v1/budgets + org-tree-state stay byte-identical.
do $$
declare missing text;
begin
  if not exists (select 1 from pg_views where schemaname='governance' and viewname='budget_tree_for_tenant') then
    raise exception 'FAIL: governance.budget_tree_for_tenant view missing'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','id','parent_id','kind','name','cap_amount','spent_amount','reserved_amount',
    'enforcement','period','alert_threshold','free_floor_enabled']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='governance' and table_name='budget_tree_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: budget_tree_for_tenant missing columns: %', missing; end if;
  if has_table_privilege('authenticated','governance.budget_tree_for_tenant','select') then
    raise exception 'FAIL: authenticated can SELECT budget_tree_for_tenant (cross-tenant leak)'; end if;
  raise notice 'M-org-1 budget_tree_for_tenant shield: BudgetNode contract + deny-all ✓';
end $$;

-- M-org-2 — budget_requests_for_tenant shield exists with the BudgetRequest contract, deny-all.
do $$
declare missing text;
begin
  if not exists (select 1 from pg_views where schemaname='governance' and viewname='budget_requests_for_tenant') then
    raise exception 'FAIL: governance.budget_requests_for_tenant view missing'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','id','node_id','requested_by','requested_cap','reason','status','created_at']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='governance' and table_name='budget_requests_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: budget_requests_for_tenant missing columns: %', missing; end if;
  if has_table_privilege('authenticated','governance.budget_requests_for_tenant','select') then
    raise exception 'FAIL: authenticated can SELECT budget_requests_for_tenant (cross-tenant leak)'; end if;
  raise notice 'M-org-2 budget_requests_for_tenant shield: BudgetRequest contract + deny-all ✓';
end $$;

-- M-org-3 (S2) — the NEW org-tree tables exist in core with RLS + a tenant read policy + the FK
-- spine (empty in S2; backfilled in S3). Privileged: authenticated SELECT-only (writes are gateway
-- service_role). RLS coverage (rls.sql) also asserts these since `core` is in its nspname set.
do $$
declare t text;
begin
  foreach t in array array['unit_levels','org_units','unit_members'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='core' and c.relname=t and c.relkind='r') then
      raise exception 'FAIL: core.% table missing', t; end if;
    if not (select relrowsecurity from pg_class where oid=('core.'||t)::regclass) then
      raise exception 'FAIL: RLS disabled on core.%', t; end if;
    if not exists (select 1 from pg_policies where schemaname='core' and tablename=t) then
      raise exception 'FAIL: core.% has no RLS policy (rls.sql coverage would fail)', t; end if;
    if not has_table_privilege('authenticated', ('core.'||t)::regclass, 'select') then
      raise exception 'FAIL: authenticated lost SELECT on core.%', t; end if;
    if has_table_privilege('authenticated', ('core.'||t)::regclass, 'insert') then
      raise exception 'FAIL: authenticated can INSERT core.% (writes must be gateway service_role)', t; end if;
  end loop;
  -- org_units: composite self-parent FK + level→unit_levels FK.
  if not exists (select 1 from pg_constraint where conrelid='core.org_units'::regclass
                  and confrelid='core.org_units'::regclass and contype='f') then
    raise exception 'FAIL: org_units self-parent FK missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='core.org_units'::regclass
                  and confrelid='core.unit_levels'::regclass and contype='f') then
    raise exception 'FAIL: org_units.level → unit_levels FK missing'; end if;
  -- unit_members → org_units + profiles.
  if not exists (select 1 from pg_constraint where conrelid='core.unit_members'::regclass
                  and confrelid='core.org_units'::regclass and contype='f') then
    raise exception 'FAIL: unit_members → org_units FK missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='core.unit_members'::regclass
                  and confrelid='core.profiles'::regclass and contype='f') then
    raise exception 'FAIL: unit_members → profiles FK missing'; end if;
  raise notice 'M-org-3 core.{unit_levels,org_units,unit_members}: RLS + policy + FK spine + SELECT-only ✓';
end $$;

\echo '== §D Phase 5: budget_nodes → governance.nodes reshape (S3) =='

-- M-org-4 — budget_nodes relocated+reshaped → governance.nodes: structure cols dropped, org_unit_id
-- FK+UNIQUE+CHECK(id==org_unit_id, DC-1), budget cols + RLS/policy intact, dependent FKs follow the OID,
-- the shield reads the split schema, core.unit_kind maps the tier, and the 1:1 backfill holds.
do $$
declare leftover text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='governance' and c.relname='nodes' and c.relkind='r') then
    raise exception 'FAIL: governance.nodes table missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='budget_nodes') then
    raise exception 'FAIL: public.budget_nodes still exists (move incomplete)'; end if;
  -- structural cols dropped (moved to core.org_units).
  select string_agg(col,', ') into leftover from unnest(array['parent_id','kind','ref_id','name']) as col
   where exists (select 1 from information_schema.columns
                  where table_schema='governance' and table_name='nodes' and column_name=col);
  if leftover is not null then raise exception 'FAIL: governance.nodes still has structural cols: %', leftover; end if;
  -- org_unit_id NOT NULL + FK + UNIQUE + CHECK(id=org_unit_id) (DC-1).
  if (select is_nullable from information_schema.columns
        where table_schema='governance' and table_name='nodes' and column_name='org_unit_id') is distinct from 'NO' then
    raise exception 'FAIL: governance.nodes.org_unit_id missing or nullable'; end if;
  if not exists (select 1 from pg_constraint where conrelid='governance.nodes'::regclass
                  and confrelid='core.org_units'::regclass and contype='f') then
    raise exception 'FAIL: governance.nodes → core.org_units FK missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='governance.nodes'::regclass
                  and contype='u' and conname='nodes_org_unit_unique') then
    raise exception 'FAIL: governance.nodes UNIQUE(tenant_id,org_unit_id) missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='governance.nodes'::regclass
                  and contype='c' and conname='nodes_id_is_unit') then
    raise exception 'FAIL: governance.nodes CHECK(id=org_unit_id) missing (DC-1)'; end if;
  -- RLS + tenant read policy (SELECT-only privileged).
  if not (select relrowsecurity from pg_class where oid='governance.nodes'::regclass) then
    raise exception 'FAIL: RLS disabled on governance.nodes'; end if;
  if not exists (select 1 from pg_policies where schemaname='governance' and tablename='nodes' and policyname='nodes_read') then
    raise exception 'FAIL: nodes_read policy missing'; end if;
  -- the carried-over budget_nodes_read policy from the RENAME must be gone (orphan-policy footgun).
  if exists (select 1 from pg_policies where schemaname='governance' and tablename='nodes' and policyname='budget_nodes_read') then
    raise exception 'FAIL: orphan budget_nodes_read policy lingers on governance.nodes'; end if;
  -- dependent FKs follow the OID: budget_holds.budget_node_id + budget_requests.node_id → governance.nodes.
  if not exists (select 1 from pg_constraint where conrelid='public.budget_holds'::regclass
                  and confrelid='governance.nodes'::regclass and contype='f') then
    raise exception 'FAIL: budget_holds → governance.nodes FK lost'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.budget_requests'::regclass
                  and confrelid='governance.nodes'::regclass and contype='f') then
    raise exception 'FAIL: budget_requests → governance.nodes FK lost'; end if;
  -- shield reads the split schema; core.unit_kind maps the tier.
  if pg_get_viewdef('governance.budget_tree_for_tenant'::regclass) !~ 'org_units' then
    raise exception 'FAIL: budget_tree_for_tenant not repointed to core.org_units'; end if;
  if core.unit_kind(0) <> 'org' or core.unit_kind(3) <> 'user' or core.unit_kind(4) <> 'service' then
    raise exception 'FAIL: core.unit_kind tier map wrong'; end if;
  -- 1:1 backfill integrity: every node has id==org_unit_id and a matching org_unit.
  if exists (select 1 from governance.nodes n where n.id <> n.org_unit_id) then
    raise exception 'FAIL: a governance.nodes row has id <> org_unit_id (DC-1 violated)'; end if;
  if exists (select 1 from governance.nodes n
              where not exists (select 1 from core.org_units ou
                                 where ou.tenant_id=n.tenant_id and ou.id=n.org_unit_id)) then
    raise exception 'FAIL: a governance.nodes row has no matching core.org_units (backfill gap)'; end if;
  raise notice 'M-org-4 budget_nodes→governance.nodes: reshaped + DC-1 (id==org_unit_id) + FK/UNIQUE/CHECK, dependent FKs follow, shield+unit_kind, 1:1 backfill ✓';
end $$;

\echo '== §D Phase 6: metering domain relocation (P6-2) =='

-- M-meter-1 — the ledger + rollup tables + MVs relocated public→metering (analytics_ prefix dropped),
-- and public is empty of the moved set.
do $$
declare o text;
begin
  select string_agg(c.relname, ', ') into o
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname in ('inference_calls','execution_traces','analytics_usage_daily','analytics_quality_daily',
                       'analytics_applied_calls','analytics_model_mix_daily','analytics_overview_current');
  if o is not null then raise exception 'FAIL: public still has moved objects: %', o; end if;
  foreach o in array array['inference_calls','execution_traces','usage_daily','quality_daily','applied_calls'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='metering' and c.relname=o and c.relkind='r') then
      raise exception 'FAIL: metering.% table missing', o; end if;
  end loop;
  foreach o in array array['model_mix_daily','overview_current'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='metering' and c.relname=o and c.relkind='m') then
      raise exception 'FAIL: metering.% matview missing', o; end if;
  end loop;
  raise notice 'M-meter-1 ledger+rollups+MVs relocated public→metering (prefix dropped) ✓';
end $$;

-- M-meter-2 — the 6 rollup functions in metering + the 2 fan-out triggers wired (metering.fanout on
-- metering.inference_calls + public.quality_signals), and no orphan analytics_*_read policy.
do $$
declare fn text;
begin
  foreach fn in array array['rollup_apply','rollup_reconcile','cloud_equiv','refresh_mviews','fanout','rollup_usage_daily'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='metering' and p.proname=fn) then
      raise exception 'FAIL: metering.% function missing', fn; end if;
  end loop;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
                  where t.tgname='inference_calls_analytics_ai' and n.nspname='metering' and c.relname='inference_calls' and not t.tgisinternal) then
    raise exception 'FAIL: inference_calls_analytics_ai trigger missing on metering.inference_calls'; end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                  where t.tgname='quality_signals_analytics_ai' and c.relname='quality_signals' and not t.tgisinternal) then
    raise exception 'FAIL: quality_signals_analytics_ai trigger missing'; end if;
  if exists (select 1 from pg_policies where schemaname='metering'
              and policyname in ('analytics_usage_daily_read','analytics_quality_daily_read')) then
    raise exception 'FAIL: orphan analytics_*_read policy lingers in metering'; end if;
  if not exists (select 1 from pg_policies where schemaname='metering' and tablename='usage_daily' and policyname='usage_daily_read') then
    raise exception 'FAIL: usage_daily_read policy missing'; end if;
  raise notice 'M-meter-2 6 rollup fns + 2 triggers wired to metering.fanout + no orphan policy ✓';
end $$;

-- M-meter-3 — MVs deny-all to authenticated (MVs cannot carry RLS); the ledger is tenant SELECT-only,
-- service_role-write. Posture assertion (the A8/A1.c harness asserts the behavior).
do $$
begin
  if has_table_privilege('authenticated','metering.model_mix_daily','select')
     or has_table_privilege('authenticated','metering.overview_current','select') then
    raise exception 'FAIL: an authenticated user can SELECT a metering MV (cross-tenant leak)'; end if;
  if not has_table_privilege('authenticated','metering.inference_calls','select') then
    raise exception 'FAIL: authenticated lost SELECT on metering.inference_calls'; end if;
  if has_table_privilege('authenticated','metering.inference_calls','insert') then
    raise exception 'FAIL: authenticated can INSERT metering.inference_calls (service_role-only ledger)'; end if;
  raise notice 'M-meter-3 MVs deny-all + ledger SELECT-only posture ✓';
end $$;

\echo '== §D Ledger Normalize: requests_ledger shield (LN-1) =='

-- M-ln-1 — requests_ledger_for_tenant shield exists with the RequestRow contract and is
-- gateway-internal (deny-all; no security_invoker → a grant would bypass inference_calls RLS →
-- cross-tenant leak). Shipped BEFORE the inference_calls FK-normalize so /v1/requests stays byte-identical.
do $$
declare missing text;
begin
  if not exists (select 1 from pg_views where schemaname='metering' and viewname='requests_ledger_for_tenant') then
    raise exception 'FAIL: metering.requests_ledger_for_tenant view missing'; end if;
  select string_agg(c, ', ') into missing from unnest(array[
    'tenant_id','id','chain_id','adapter','model','budget_node_id','execution_location',
    'input_tokens','output_tokens','cost_usd','duration_ms','status','fallback_sequence','recorded_at']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema='metering' and table_name='requests_ledger_for_tenant' and column_name=c);
  if missing is not null then raise exception 'FAIL: requests_ledger_for_tenant missing columns: %', missing; end if;
  if has_table_privilege('authenticated','metering.requests_ledger_for_tenant','select') then
    raise exception 'FAIL: authenticated can SELECT requests_ledger_for_tenant (bypasses inference_calls RLS → cross-tenant leak)'; end if;
  raise notice 'M-ln-1 requests_ledger_for_tenant shield: RequestRow contract + deny-all ✓';
end $$;

\echo '== §D Ledger Normalize: signal_subject enum + feedback (LN-2a) =='

-- M-ln-2a — the typed-subject enum + the NEW user-feedback table (split out of quality_signals).
-- feedback is owner-INSERT (with check actor=auth.uid()) + tenant SELECT, no U/D; the exactly-one-per-
-- subject CHECK encodes the resolved 'event' subtype (event = no call/message/conversation, target in json).
do $$
declare vals text; missing text;
begin
  select string_agg(e.enumlabel,',' order by e.enumsortorder) into vals
    from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
   where n.nspname='metering' and t.typname='signal_subject';
  if vals is distinct from 'call,message,conversation,event' then
    raise exception 'FAIL: metering.signal_subject = % (expected call,message,conversation,event)', coalesce(vals,'<none>'); end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='metering' and c.relname='feedback' and c.relkind='r') then
    raise exception 'FAIL: metering.feedback table missing'; end if;
  select string_agg(col,', ') into missing from unnest(array[
    'tenant_id','id','subject_type','inference_call_id','message_id','conversation_id','actor_id','kind','value','created_at']) as col
   where not exists (select 1 from information_schema.columns where table_schema='metering' and table_name='feedback' and column_name=col);
  if missing is not null then raise exception 'FAIL: feedback missing columns: %', missing; end if;
  if (select udt_name from information_schema.columns where table_schema='metering' and table_name='feedback' and column_name='subject_type')
     is distinct from 'signal_subject' then raise exception 'FAIL: feedback.subject_type is not the signal_subject enum'; end if;
  if not exists (select 1 from pg_constraint where conrelid='metering.feedback'::regclass and contype='c' and conname='feedback_subject_one') then
    raise exception 'FAIL: feedback exactly-one-subject CHECK missing'; end if;
  if not (select relrowsecurity from pg_class where oid='metering.feedback'::regclass) then
    raise exception 'FAIL: RLS disabled on metering.feedback'; end if;
  if not exists (select 1 from pg_policies where schemaname='metering' and tablename='feedback' and cmd='INSERT') then
    raise exception 'FAIL: feedback owner-INSERT policy missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='metering' and tablename='feedback' and cmd='SELECT') then
    raise exception 'FAIL: feedback tenant SELECT policy missing'; end if;
  if has_table_privilege('authenticated','metering.feedback','update') or has_table_privilege('authenticated','metering.feedback','delete') then
    raise exception 'FAIL: authenticated can UPDATE/DELETE feedback (should be insert-own + select only)'; end if;
  raise notice 'M-ln-2a signal_subject enum + feedback (owner-INSERT, exactly-one-subject CHECK, no U/D) ✓';
end $$;

-- M-ln-2b — routing_attempts (normalized trace) + the execution_traces populate trigger + RLS SELECT-only.
do $$
declare missing text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='metering' and c.relname='routing_attempts' and c.relkind='r') then
    raise exception 'FAIL: metering.routing_attempts table missing'; end if;
  select string_agg(col,', ') into missing from unnest(array[
    'tenant_id','id','inference_call_id','attempt_no','adapter','model','api_model_id','plane',
    'latency_ms','outcome','cost_usd','error','fallback_triggered']) as col
   where not exists (select 1 from information_schema.columns where table_schema='metering' and table_name='routing_attempts' and column_name=col);
  if missing is not null then raise exception 'FAIL: routing_attempts missing columns: %', missing; end if;
  if not exists (select 1 from pg_constraint where conrelid='metering.routing_attempts'::regclass
                  and confrelid='metering.inference_calls'::regclass and contype='f') then
    raise exception 'FAIL: routing_attempts → inference_calls FK missing'; end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
                  where t.tgname='execution_traces_routing_attempts_ai' and n.nspname='metering' and c.relname='execution_traces' and not t.tgisinternal) then
    raise exception 'FAIL: execution_traces_routing_attempts_ai trigger missing'; end if;
  if not (select relrowsecurity from pg_class where oid='metering.routing_attempts'::regclass) then
    raise exception 'FAIL: RLS disabled on metering.routing_attempts'; end if;
  if not exists (select 1 from pg_policies where schemaname='metering' and tablename='routing_attempts' and policyname='routing_attempts_read') then
    raise exception 'FAIL: routing_attempts_read policy missing'; end if;
  if has_table_privilege('authenticated','metering.routing_attempts','insert') then
    raise exception 'FAIL: authenticated can INSERT routing_attempts (service_role-only)'; end if;
  raise notice 'M-ln-2b routing_attempts + populate trigger + RLS SELECT-only ✓';
end $$;

-- M-ln-2c — quality_signals reshaped + moved public→metering: typed subject_type + exactly-one-per-type
-- CHECK (event-aware), old polymorphic CHECK gone; the fanout trigger now sits on metering.quality_signals.
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='metering' and c.relname='quality_signals' and c.relkind='r') then
    raise exception 'FAIL: metering.quality_signals table missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='quality_signals') then
    raise exception 'FAIL: public.quality_signals still exists (move incomplete)'; end if;
  if (select udt_name from information_schema.columns where table_schema='metering' and table_name='quality_signals' and column_name='subject_type')
     is distinct from 'signal_subject' then raise exception 'FAIL: quality_signals.subject_type is not the signal_subject enum'; end if;
  if (select is_nullable from information_schema.columns where table_schema='metering' and table_name='quality_signals' and column_name='subject_type')
     is distinct from 'NO' then raise exception 'FAIL: quality_signals.subject_type nullable'; end if;
  if not exists (select 1 from pg_constraint where conrelid='metering.quality_signals'::regclass and contype='c' and conname='quality_signals_subject_one') then
    raise exception 'FAIL: quality_signals exactly-one-subject CHECK missing'; end if;
  if exists (select 1 from pg_constraint where conrelid='metering.quality_signals'::regclass and conname='quality_signals_target') then
    raise exception 'FAIL: old polymorphic quality_signals_target CHECK lingers'; end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
                  where t.tgname='quality_signals_analytics_ai' and n.nspname='metering' and c.relname='quality_signals' and not t.tgisinternal) then
    raise exception 'FAIL: quality_signals_analytics_ai trigger not on metering.quality_signals'; end if;
  raise notice 'M-ln-2c quality_signals → metering + typed subject_type + exactly-one CHECK + trigger ✓';
end $$;

\echo '== §D Ledger Normalize: legacy retirement (LN-3a) =='

-- M-ln-3a — sessions/session_logs/gateway_tasks/gateway_task_logs RETIRED (dropped). The
-- inference_calls→sessions FK is necessarily gone (you can't drop sessions while an inbound FK exists).
-- (The vestigial session_id/project_id cols were later DROPPED in LN-4b — see M-ln-4b.)
do $$
declare t text;
begin
  foreach t in array array['sessions','session_logs','gateway_tasks','gateway_task_logs'] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relname=t) then
      raise exception 'FAIL: public.% still exists (legacy retire incomplete)', t; end if;
  end loop;
  if exists (select 1 from pg_constraint where conrelid='metering.inference_calls'::regclass
              and contype='f' and conname='inference_calls_session_fkey') then
    raise exception 'FAIL: inference_calls_session_fkey still present'; end if;
  raise notice 'M-ln-3a legacy sessions/gateway_tasks retired, inference_calls→sessions FK dropped ✓';
end $$;

\echo '== §D Ledger Normalize: inference_calls.org_unit_id (LN-3c-1, additive) =='

-- M-ln-3c1 — inference_calls.org_unit_id added additively with FK→core.org_units (ON DELETE SET NULL —
-- never cascade-delete billing history). == budget_node_id under P5 DC-1; store.rs writes both. The
-- analytics/rollup read migration + the P12 denorm reversal (drop budget_node_id + *_node_id) is LN-3c-2.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='metering' and table_name='inference_calls' and column_name='org_unit_id') then
    raise exception 'FAIL: inference_calls.org_unit_id missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='metering.inference_calls'::regclass
                  and confrelid='core.org_units'::regclass and contype='f') then
    raise exception 'FAIL: inference_calls → core.org_units FK missing'; end if;
  raise notice 'M-ln-3c1 inference_calls.org_unit_id + FK→core.org_units (additive) ✓';
end $$;

-- M-ln-3c2a — the ROLLUP-side budget_node_id → org_unit_id rename (usage_daily/quality_daily grain +
-- rollup fns + analytics reads). Unambiguous (rollup attribution only); the LEDGER budget_node_id +
-- the budget-MACHINERY budget_node_id (holds/reserve/service_accounts) are UNTOUCHED. Spend-by-tier
-- still groups by *_node_id (the P12 reversal is LN-3c-2b).
do $$
declare t text;
begin
  foreach t in array array['usage_daily','quality_daily'] loop
    if not exists (select 1 from information_schema.columns where table_schema='metering' and table_name=t and column_name='org_unit_id') then
      raise exception 'FAIL: metering.%.org_unit_id missing (rollup rename incomplete)', t; end if;
    if exists (select 1 from information_schema.columns where table_schema='metering' and table_name=t and column_name='budget_node_id') then
      raise exception 'FAIL: metering.%.budget_node_id still present (should be renamed)', t; end if;
  end loop;
  -- footgun guard: the budget-machinery budget_node_id MUST survive.
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='budget_holds' and column_name='budget_node_id') then
    raise exception 'FAIL: budget_holds.budget_node_id was wrongly renamed (budget-machinery corrupted)'; end if;
  raise notice 'M-ln-3c2a rollup budget_node_id→org_unit_id (machinery budget_node_id intact) ✓';
end $$;

-- M-ln-3c2b — the P12 REVERSAL: inference_calls budget_node_id + the 4 *_node_id denorm cols DROPPED;
-- org_unit_id remains; core.org_unit_ancestor_at_level backs spend-by-tier; the requests_ledger shield
-- still exposes budget_node_id (= org_unit_id) for the RequestRow contract; budget-machinery intact.
do $$
declare leftover text;
begin
  select string_agg(col,', ') into leftover from unnest(array['budget_node_id','org_node_id','dept_node_id','team_node_id','user_node_id']) as col
   where exists (select 1 from information_schema.columns where table_schema='metering' and table_name='inference_calls' and column_name=col);
  if leftover is not null then raise exception 'FAIL: inference_calls still has denorm cols: %', leftover; end if;
  if not exists (select 1 from information_schema.columns where table_schema='metering' and table_name='inference_calls' and column_name='org_unit_id') then
    raise exception 'FAIL: inference_calls.org_unit_id missing'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core' and p.proname='org_unit_ancestor_at_level') then
    raise exception 'FAIL: core.org_unit_ancestor_at_level missing (spend-by-tier has no walker)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='metering' and table_name='requests_ledger_for_tenant' and column_name='budget_node_id') then
    raise exception 'FAIL: requests_ledger_for_tenant lost budget_node_id (RequestRow contract broke)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='budget_holds' and column_name='budget_node_id') then
    raise exception 'FAIL: budget_holds.budget_node_id wrongly dropped (budget-machinery corrupted)'; end if;
  raise notice 'M-ln-3c2b P12 reversal: denorm cols dropped, org_unit_id + ancestor fn + shield alias + machinery intact ✓';
end $$;

-- M-ln-3b1 — FK-normalize (ADDITIVE): inference_calls gains endpoint_id/model_id/router_id → catalog
-- (ON DELETE SET NULL, fail-soft), resolved at write via the is_default desc / priority asc lateral.
-- adapter/model/chain_id free-text are KEPT (dual-write snapshot; the drop is LN-3b-2). Also proves the
-- resolution lateral lands a real seeded endpoint and MISSES (null) on a bogus api_model_id.
do $$
declare
  missing  text;
  bad_del  text;
  resolved uuid;
  miss     uuid;
begin
  -- (a) the 3 FK cols exist
  select string_agg(col,', ') into missing from unnest(array['endpoint_id','model_id','router_id']) as col
   where not exists (select 1 from information_schema.columns
                      where table_schema='metering' and table_name='inference_calls' and column_name=col);
  if missing is not null then raise exception 'FAIL: inference_calls missing LN-3b FK cols: %', missing; end if;

  -- (b) all 3 FKs target the catalog and are ON DELETE SET NULL (confdeltype 'n') — never cascade-delete
  -- billing history when a catalog endpoint/model/router is retired.
  select string_agg(conname,', ') into bad_del from pg_constraint c
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
   where n.nspname='metering' and t.relname='inference_calls' and c.contype='f'
     and conname in ('inference_calls_endpoint_id_fkey','inference_calls_model_id_fkey','inference_calls_router_id_fkey')
     and c.confdeltype <> 'n';
  if bad_del is not null then raise exception 'FAIL: LN-3b FK not ON DELETE SET NULL: %', bad_del; end if;
  if (select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
       where n.nspname='metering' and t.relname='inference_calls' and c.contype='f'
         and conname in ('inference_calls_endpoint_id_fkey','inference_calls_model_id_fkey','inference_calls_router_id_fkey')) <> 3 then
    raise exception 'FAIL: LN-3b expects exactly 3 catalog FKs on inference_calls'; end if;

  -- (c) free-text snapshot KEPT (LN-3b-1 is additive dual-write; dropping adapter/model/chain_id is LN-3b-2)
  if not exists (select 1 from information_schema.columns where table_schema='metering' and table_name='inference_calls' and column_name='adapter')
     or not exists (select 1 from information_schema.columns where table_schema='metering' and table_name='inference_calls' and column_name='model') then
    raise exception 'FAIL: LN-3b-1 must KEEP adapter/model free-text (dual-write snapshot)'; end if;

  -- (d) resolution lateral (the store.rs write-resolution): a real seeded pair resolves; a bogus one misses.
  select ep.id into resolved from (select 1) o left join lateral (
    select me.id from catalog.model_endpoints me join catalog.routers r on r.id=me.router_id
     where r.name='anthropic' and me.router_model_id='claude-3-5-sonnet-20241022' and me.is_active
     order by me.is_default desc, me.priority asc limit 1) ep on true;
  if resolved is null then raise exception 'FAIL: LN-3b resolution found no seeded anthropic endpoint (catalog api_model_id mapping absent)'; end if;
  select ep.id into miss from (select 1) o left join lateral (
    select me.id from catalog.model_endpoints me join catalog.routers r on r.id=me.router_id
     where r.name='anthropic' and me.router_model_id='no-such-api-model-zzz' and me.is_active
     order by me.is_default desc, me.priority asc limit 1) ep on true;
  if miss is not null then raise exception 'FAIL: LN-3b resolution must MISS (null) on a bogus api_model_id'; end if;

  raise notice 'M-ln-3b1 FK-normalize additive: endpoint/model/router_id + 3 catalog FKs (on delete set null) + resolution lateral hit/miss + free-text kept ✓';
end $$;

-- M-ln-4a — cost_estimated (the crate-coupled slice): inference_calls snapshots the gateway's pre-call
-- cost estimate alongside the actual cost_usd; the requests_ledger shield exposes it (appended at END for
-- CREATE OR REPLACE idempotency). cost_estimated nullable (some paths — the C6 judge — produce no estimate).
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='metering' and table_name='inference_calls' and column_name='cost_estimated') then
    raise exception 'FAIL: inference_calls.cost_estimated missing (LN-4 crate field not landed)'; end if;
  if (select is_nullable from information_schema.columns
       where table_schema='metering' and table_name='inference_calls' and column_name='cost_estimated') <> 'YES' then
    raise exception 'FAIL: cost_estimated must be nullable (fail-soft — some paths have no estimate)'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='metering' and table_name='requests_ledger_for_tenant' and column_name='cost_estimated') then
    raise exception 'FAIL: requests_ledger_for_tenant does not expose cost_estimated'; end if;
  raise notice 'M-ln-4a cost_estimated on inference_calls (nullable) + requests_ledger shield ✓';
end $$;

-- M-ln-4b — the cost rename + linkage cleanup: inference_calls.cost_usd RENAMED → cost_actual (pairs with
-- cost_estimated); vestigial session_id/project_id DROPPED; nullable conversation_id ADDED (no FK; P7
-- writer). The requests_ledger shield still exposes cost_usd (aliased from cost_actual) → RequestRow
-- byte-identical. The rollup fns read cost_actual (verified by analytics.sql over the reshaped ledger).
do $$
declare gone text;
begin
  if exists (select 1 from information_schema.columns
              where table_schema='metering' and table_name='inference_calls' and column_name='cost_usd') then
    raise exception 'FAIL: inference_calls.cost_usd not renamed (LN-4b expects cost_actual)'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='metering' and table_name='inference_calls' and column_name='cost_actual') then
    raise exception 'FAIL: inference_calls.cost_actual missing'; end if;
  select string_agg(col,', ') into gone from unnest(array['session_id','project_id']) as col
   where exists (select 1 from information_schema.columns
                  where table_schema='metering' and table_name='inference_calls' and column_name=col);
  if gone is not null then raise exception 'FAIL: LN-4b did not drop vestigial cols: %', gone; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='metering' and table_name='inference_calls' and column_name='conversation_id') then
    raise exception 'FAIL: inference_calls.conversation_id missing'; end if;
  -- shield still exposes cost_usd (the RequestRow contract name), sourced from cost_actual.
  if not exists (select 1 from information_schema.columns
                  where table_schema='metering' and table_name='requests_ledger_for_tenant' and column_name='cost_usd') then
    raise exception 'FAIL: requests_ledger lost cost_usd (RequestRow contract broke)'; end if;
  raise notice 'M-ln-4b cost_usd→cost_actual + session_id/project_id dropped + conversation_id added + shield contract intact ✓';
end $$;

\echo '== §D moves tests done =='
