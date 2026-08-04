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

\echo '== §D moves tests done =='
