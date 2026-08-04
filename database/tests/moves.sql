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

\echo '== §D moves tests done =='
