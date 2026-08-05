-- F1 RLS test harness — run after `dbd apply && dbd import && dbd policies`.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls.sql   (or: tests/run.sh)
-- Any failed assertion raises an exception → non-zero exit (CI-friendly).
\set ON_ERROR_STOP on

\echo '== 1. RLS coverage: every tenant table has RLS enabled (+ a policy, except deny-all secrets) =='
do $$
declare
  bad text;
begin
  select string_agg(t.schemaname || '.' || t.tablename, ', ')
    into bad
  from (
    select n.nspname as schemaname, c.relname as tablename, c.oid, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname in ('core', 'public', 'audit', 'device', 'catalog', 'keyvault', 'governance', 'metering')
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      )
  ) t
  where t.relrowsecurity = false
     or (
       -- deny-all, service_role-only tables: RLS on + 0 policies is the correct posture
       t.tablename not in ('router_credentials', 'tenant_keys', 'tenant_key_archive', 'siem_cursors',
                           'applied_calls')  -- O2 internal apply-marker, service_role-only (§D Phase 6: was analytics_applied_calls)
       and not exists (
         select 1 from pg_policies p
         where p.schemaname = t.schemaname and p.tablename = t.tablename
       )
     );

  if bad is not null then
    raise exception 'RLS coverage FAILED — tenant tables missing RLS/policy: %', bad;
  end if;
  raise notice 'RLS coverage OK';
end $$;

\echo '== 2. isolation negatives (cross-tenant / confidential / secrets / append-only audit) =='
begin;
  -- setup (superuser)
  insert into core.tenants(id, name, slug, is_platform, status, modified_by)
    values ('99999999-9999-9999-9999-999999999999', 'TestB', 'testb', false, 'active', 'test')
    on conflict (id) do nothing;
  insert into public.sessions(tenant_id, user_id, module_id) values
    ('00000000-0000-0000-0000-000000000000', 'plat', (select id from governance.modules limit 1)),
    ('99999999-9999-9999-9999-999999999999', 'b',    (select id from governance.modules limit 1));
  insert into public.spaces(tenant_id, id, name, classification, owner_id, modified_by)
    values ('00000000-0000-0000-0000-000000000000', '5face999-0000-0000-0000-000000000099', 'S', 'confidential', 'aaaaaaaa-0000-0000-0000-000000000001', 't');
  insert into public.documents(tenant_id, id, original_filename, content_type, space_id, classification)
    values ('00000000-0000-0000-0000-000000000000', 'd0c99999-0000-0000-0000-000000000099', 'x.pdf', 'application/pdf', '5face999-0000-0000-0000-000000000099', 'confidential');

  -- inference ledger rows owned by tenant B — the platform (tenant A) user below
  -- must NOT see them (cross-tenant isolation).
  insert into metering.inference_calls(
      tenant_id, id, capability, adapter, model,
      cost_usd, duration_ms, status, fallback_sequence, recorded_at
  ) values (
      '99999999-9999-9999-9999-999999999999',
      'ca110000-0000-0000-0000-000000000001',
      'text_chat', 'anthropic', 'claude-sonnet',
      0.003, 1200, 'success', 0, now()
  );

  insert into metering.execution_traces(
      tenant_id, id, inference_call_id, trace, recorded_at
  ) values (
      '99999999-9999-9999-9999-999999999999',
      'd7ace000-0000-0000-0000-000000000001',
      'ca110000-0000-0000-0000-000000000001',
      '{"request_id":"test","status":"success","duration_ms":1200}',
      now()
  );

  set local role authenticated;
  -- outsider in the platform tenant (not a member of space S)
  set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","tenant_id":"00000000-0000-0000-0000-000000000000"}';

  do $$
  begin
    if (select count(*) from public.sessions) <> 1 then
      raise exception 'FAIL cross-tenant: platform user sees % sessions (expected 1)', (select count(*) from public.sessions);
    end if;

    if (select count(*) from public.documents where classification = 'confidential') <> 0 then
      raise exception 'FAIL confidential: non-member can see confidential documents';
    end if;

    begin
      perform 1 from keyvault.router_credentials;
      raise exception 'FAIL secrets: router_credentials readable by authenticated';
    exception when insufficient_privilege then null;
    end;

    begin
      update audit.audit_events set action = 'x';
      raise exception 'FAIL audit: UPDATE allowed for authenticated';
    exception when insufficient_privilege then null;
    end;

    -- inference_calls: the platform user cannot see the OTHER tenant's calls.
    -- Assert on the foreign tenant's rows specifically — the platform tenant may
    -- legitimately hold its own inference_calls, so a bare count(*)=0 is non-hermetic
    -- (it only passed on an empty table). RLS must hide the 99999999… rows.
    if exists (select 1 from metering.inference_calls
                where tenant_id = '99999999-9999-9999-9999-999999999999') then
      raise exception 'FAIL cross-tenant: platform user can see another tenant''s inference_calls';
    end if;

    -- execution_traces: same invariant — cannot see the other tenant's traces.
    if exists (select 1 from metering.execution_traces
                where tenant_id = '99999999-9999-9999-9999-999999999999') then
      raise exception 'FAIL cross-tenant: platform user can see another tenant''s execution_traces';
    end if;

    raise notice 'isolation negatives OK';
  end $$;
rollback;

\echo 'ALL RLS TESTS PASSED'
