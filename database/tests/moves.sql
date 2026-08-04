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

\echo '== §D moves tests done =='
