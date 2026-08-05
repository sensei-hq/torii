-- RW12 · adversarial authz harness — proves the F1-rework security holes stay
-- closed. Run after apply+import+policies:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/authz.sql
-- Every privileged mutation attempted as `authenticated` (or `anon`) MUST be
-- denied (grant/RLS/trigger). A hole that reopens raises → non-zero exit.
\set ON_ERROR_STOP on

\echo '== RW12 adversarial authz — each privileged mutation must be DENIED =='
begin;
  -- Seed: a member (M) of the platform tenant who owns one internal doc.
  insert into core.profiles (id) values ('11111111-1111-1111-1111-111111111111')
    on conflict do nothing;
  insert into public.documents(tenant_id, id, original_filename, content_type, classification, profile_id, scope)
    values ('00000000-0000-0000-0000-000000000000','d0cabc00-0000-0000-0000-0000000000aa',
            'own.pdf','application/pdf','internal','11111111-1111-1111-1111-111111111111','user')
    on conflict do nothing;
  insert into public.spaces(tenant_id, id, name, classification, owner_id, modified_by)
    values ('00000000-0000-0000-0000-000000000000','5face000-0000-0000-0000-0000000000aa',
            'Conf','confidential','22222222-2222-2222-2222-222222222222','t')
    on conflict do nothing;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","tenant_id":"00000000-0000-0000-0000-000000000000"}';

  do $$
  declare ok boolean;
  begin
    -- 1. Role escalation: grant self a role → DENIED (profile_roles SELECT-only).
    begin
      insert into core.profile_roles(tenant_id, profile_id, role_id)
        values ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',
                (select id from core.roles where key='owner' limit 1));
      raise exception 'FAIL escalation: member could INSERT profile_roles (grant self a role)';
    exception when insufficient_privilege then null; end;

    -- 2. Self budget-raise: UPDATE governance.nodes.cap → DENIED (SELECT-only). §D Phase 5.
    begin
      update governance.nodes set cap_amount = 999999;
      raise exception 'FAIL budget: member could UPDATE governance.nodes.cap_amount';
    exception when insufficient_privilege then null; end;

    -- 3. Confidential self-join: INSERT space_members → DENIED (SELECT-only).
    begin
      insert into public.space_members(tenant_id, space_id, profile_id)
        values ('00000000-0000-0000-0000-000000000000','5face000-0000-0000-0000-0000000000aa',
                '11111111-1111-1111-1111-111111111111');
      raise exception 'FAIL confidential: member could self-join a space (INSERT space_members)';
    exception when insufficient_privilege then null; end;

    -- 4. Classification downgrade of OWN doc → DENIED (trigger; declassify → gateway).
    begin
      update public.documents set classification = 'public'
        where id = 'd0cabc00-0000-0000-0000-0000000000aa';
      raise exception 'FAIL declassify: member could lower classification on their own doc';
    exception when raise_exception then
      if sqlerrm like 'FAIL%' then raise; end if;  -- re-raise our own failure
    end;

    -- 5. Audit forgery: INSERT audit_events attributing another actor → DENIED (with-check).
    begin
      insert into audit.audit_events(tenant_id, actor_id, action)
        values ('00000000-0000-0000-0000-000000000000','99999999-9999-9999-9999-999999999999','forged');
      raise exception 'FAIL audit: member could forge actor_id on an audit event';
    exception when check_violation or insufficient_privilege then null; end;

    -- 6. API keys are not client-writable (issuance is a service_role gateway
    -- action; only a hash+prefix is ever stored, never the raw key).
    begin
      insert into core.api_keys(tenant_id, profile_id, hashed_secret, prefix)
        values ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','h','sk_x');
      raise exception 'FAIL apikey: member could INSERT api_keys';
    exception when insufficient_privilege then null; end;

    -- 7. Chain tamper: UPDATE fallback_chains → DENIED (SELECT-only).
    begin
      update catalog.chains set name = 'x';
      raise exception 'FAIL chain: member could UPDATE fallback_chains';
    exception when insufficient_privilege then null; end;

    raise notice 'RW12 authenticated adversarial writes: all DENIED ✓';
  end $$;
rollback;

-- 8. config.feature_states was RETIRED (§D Phase 4 — per-user feature state, 0 rows/0 readers,
-- design-ratified). The old RW6 hole (anon writing it) is closed by removal; assert it's gone.
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where c.relname='feature_states') then
    raise exception 'FAIL: feature_states still exists (should be retired in §D Phase 4)'; end if;
  raise notice 'RW12 config.feature_states retired (no per-user feature-state table) ✓';
end $$;

-- 9. Anti-escalation subset guard (HIGH #3): `/rpc/rbac/assign-role` refuses to
-- grant a role whose capabilities are NOT a subset of the actor's own. Proven here
-- as the data invariant the gateway guard relies on: `owner`'s capabilities are NOT
-- a subset of `admin`'s (admin holds `role.manage` but NOT `tenant.manage`), so an
-- admin assigning `owner` (to self or anyone) hits assigned ⊄ actor → 403.
begin;
  do $$
  declare
    t          uuid := '00000000-0000-0000-0000-000000000000';
    owner_role uuid := (select role_id from core.effective_roles where tenant_id = t and key = 'owner');
    admin_role uuid := (select role_id from core.effective_roles where tenant_id = t and key = 'admin');
    escalating int;
  begin
    -- Capabilities `owner` grants that `admin` does not → the subset check denies them.
    -- Read via core.effective_* views: default roles/perms are shared rows (tenant_id
    -- NULL) exposed per-tenant through the views (project-rbac-shared-defaults) — the
    -- base tables carry no concrete-tenant rows, so resolution MUST go through them.
    select count(*) into escalating
      from core.effective_role_permissions o
     where o.role_id = owner_role and o.tenant_id = t
       and not exists (
         select 1 from core.effective_role_permissions a
          where a.role_id = admin_role and a.tenant_id = t
            and a.capability = o.capability);
    if escalating = 0 then
      raise exception 'FAIL escalation-subset: owner adds no capability beyond admin — guard would wrongly ALLOW admin→owner';
    end if;
    -- The canonical escalation cap must be owner-only (admin cannot self-grant it).
    if not exists (select 1 from core.effective_role_permissions
                     where role_id = owner_role and tenant_id = t and capability = 'tenant.manage')
       or exists (select 1 from core.effective_role_permissions
                    where role_id = admin_role and tenant_id = t and capability = 'tenant.manage') then
      raise exception 'FAIL escalation-subset: tenant.manage is not owner-only as expected';
    end if;
    raise notice 'RW12 anti-escalation subset: admin CANNOT gain tenant.manage via owner (owner ⊄ admin) ✓';
  end $$;
rollback;

-- 10. Last-owner guard (`/rpc/rbac/unassign-role`, HIGH): removing a role must NOT
-- leave the tenant with zero `tenant.manage` holders. Proven with the gateway's exact
-- `owners_after` query, in an isolated + rolled-back tenant so live data is untouched.
begin;
  do $$
  declare
    tt          uuid := 'ffff0000-0000-0000-0000-0000000000a0';
    owner_role  uuid := 'ffff0000-0000-0000-0000-0000000000a1';
    editor_role uuid := 'ffff0000-0000-0000-0000-0000000000a2';
    o1          uuid := 'ffff0000-0000-0000-0000-0000000000b1';
    o2          uuid := 'ffff0000-0000-0000-0000-0000000000b2';
    n int;
  begin
    insert into core.tenants(id, name, slug, modified_by)
      values (tt, 'authz-test', 'authz-test-a0', 't');
    insert into core.roles(id, tenant_id, key, name) values
      (owner_role,  tt, 'owner',  'Owner'),
      (editor_role, tt, 'editor', 'Editor');
    insert into core.role_permissions(tenant_id, role_id, capability) values
      (tt, owner_role,  'tenant.manage'),
      (tt, owner_role,  'role.manage'),
      (tt, editor_role, 'doc.write');
    insert into core.profiles(id) values (o1),(o2) on conflict do nothing;
    insert into core.profile_roles(tenant_id, profile_id, role_id) values (tt, o1, owner_role);

    -- (a) O1 is the SOLE owner → removing O1's owner role leaves 0 → guard REJECTS.
    select count(distinct pr.profile_id) into n
      from core.profile_roles pr
      join core.role_permissions rp on rp.role_id = pr.role_id and rp.tenant_id = pr.tenant_id
     where pr.tenant_id = tt and rp.capability = 'tenant.manage'
       and not (pr.profile_id = o1 and pr.role_id = owner_role);
    if n <> 0 then raise exception 'FAIL last-owner: sole-owner removal → owners_after=% (want 0)', n; end if;

    -- (b) add O2 as a 2nd owner → removing O1 leaves 1 → guard ALLOWS.
    insert into core.profile_roles(tenant_id, profile_id, role_id) values (tt, o2, owner_role);
    select count(distinct pr.profile_id) into n
      from core.profile_roles pr
      join core.role_permissions rp on rp.role_id = pr.role_id and rp.tenant_id = pr.tenant_id
     where pr.tenant_id = tt and rp.capability = 'tenant.manage'
       and not (pr.profile_id = o1 and pr.role_id = owner_role);
    if n <> 1 then raise exception 'FAIL last-owner: with 2 owners, removing one → owners_after=% (want 1)', n; end if;

    -- (c) removing a NON-owner role never trips the guard (both owners still counted).
    insert into core.profile_roles(tenant_id, profile_id, role_id) values (tt, o1, editor_role);
    select count(distinct pr.profile_id) into n
      from core.profile_roles pr
      join core.role_permissions rp on rp.role_id = pr.role_id and rp.tenant_id = pr.tenant_id
     where pr.tenant_id = tt and rp.capability = 'tenant.manage'
       and not (pr.profile_id = o1 and pr.role_id = editor_role);
    if n <> 2 then raise exception 'FAIL last-owner: removing a non-owner role changed the owner count → % (want 2)', n; end if;

    raise notice 'RW12 last-owner guard: sole-owner removal BLOCKED, 2nd-owner removal ALLOWED, non-owner removal safe ✓';
  end $$;
rollback;

\echo '== O1 append-only: audit_events is immutable even to superuser =='
begin;
  do $$
  begin
    -- this connection is the postgres superuser (RLS-bypassing); prove the
    -- append-only trigger denies UPDATE/DELETE on audit_events regardless of role.
    if not exists (select 1 from audit.audit_events) then
      insert into audit.audit_events (tenant_id, action, actor_id)
        values ('00000000-0000-0000-0000-000000000000', 'test.append_only', null);
    end if;
    begin
      update audit.audit_events set action = 'tampered';
      raise exception 'FAIL append-only: UPDATE allowed on audit_events (superuser)';
    exception when insufficient_privilege then null; end;
    begin
      delete from audit.audit_events;
      raise exception 'FAIL append-only: DELETE allowed on audit_events (superuser)';
    exception when insufficient_privilege then null; end;
    raise notice 'O1 audit_events append-only (immutable to superuser) ✓';
  end $$;
rollback;

-- 12. O2 analytics — tenant isolation + no client write + no secret/PII surface (A8).
begin;
  insert into core.tenants(id, name, slug, is_platform, status, modified_by)
    values ('99999999-9999-9999-9999-999999999999', 'TestB', 'testb', false, 'active', 'test')
    on conflict (id) do nothing;
  -- one usage-rollup row per tenant (superuser write; the grid columns are all NOT NULL).
  insert into metering.usage_daily
    (tenant_id, day, budget_node_id, served_model, provider, capability, execution_location, calls, cost_usd) values
    ('00000000-0000-0000-0000-000000000000','2026-07-30','b0de0000-0000-0000-0000-0000000000f1','claude','anthropic','text_chat','cloud',1,0.01),
    ('99999999-9999-9999-9999-999999999999','2026-07-30','b0de0000-0000-0000-0000-0000000000f2','claude','anthropic','text_chat','cloud',1,0.02);

  -- (a) structural: no free-text/content/secret column on the rollups (only metadata).
  do $$
  declare bad text;
  begin
    select string_agg(table_name||'.'||column_name, ', ') into bad
      from information_schema.columns
     where table_schema='metering'
       and table_name in ('usage_daily','quality_daily','applied_calls')
       and column_name ~ '(content|prompt|response|secret|body|message|payload|api_key|token_text)';
    if bad is not null then
      raise exception 'FAIL A8: analytics rollups expose a content/secret column: %', bad; end if;
    raise notice 'A8 analytics rollups carry metadata only (no content/secret column) ✓';
  end $$;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","tenant_id":"00000000-0000-0000-0000-000000000000"}';
  do $$
  begin
    -- (b) cross-tenant isolation: tenant A sees ONLY its own rollup row, never tenant B's.
    if (select count(*) from metering.usage_daily) <> 1 then
      raise exception 'FAIL A8: tenant A sees % analytics rows (expected 1 — B leaked)',
        (select count(*) from metering.usage_daily); end if;
    if (select count(*) from metering.usage_daily
          where tenant_id='99999999-9999-9999-9999-999999999999') <> 0 then
      raise exception 'FAIL A8: tenant A can read tenant B analytics rows'; end if;

    -- (c) no client write on the rollups (grant revoked → insufficient_privilege).
    begin
      insert into metering.usage_daily
        (tenant_id, day, budget_node_id, served_model, provider, capability, execution_location)
        values ('00000000-0000-0000-0000-000000000000','2026-07-31','b0de0000-0000-0000-0000-0000000000f1','x','x','x','cloud');
      raise exception 'FAIL A8: authenticated could INSERT analytics_usage_daily';
    exception when insufficient_privilege then null; end;
    -- MVs + the apply-marker are not readable by authenticated at all (no RLS on MVs).
    begin
      perform 1 from metering.model_mix_daily;
      raise exception 'FAIL A8: authenticated could SELECT analytics_model_mix_daily (MV → no RLS)';
    exception when insufficient_privilege then null; end;
    begin
      perform 1 from metering.applied_calls;
      raise exception 'FAIL A8: authenticated could SELECT analytics_applied_calls (internal marker)';
    exception when insufficient_privilege then null; end;
    raise notice 'A8 analytics tenant-isolation + write-denied + MV/marker-locked ✓';
  end $$;
rollback;

-- 13. O3-4 device fleet — own-vs-`device.manage` read scope + no client write. A member
-- without device.manage must see ONLY their own devices (regression guard against the
-- tenant-wide devices_read policy reopening), and sync_policy is service_role-only.
begin;
  insert into core.profiles (id) values
    ('11111111-1111-1111-1111-111111111111'),
    ('22222222-2222-2222-2222-222222222222') on conflict do nothing;
  -- two devices in the platform tenant: one owned by member M (11111111), one by another user.
  insert into device.devices(tenant_id, id, profile_id, name, status) values
    ('00000000-0000-0000-0000-000000000000','deac0000-0000-0000-0000-0000000000a1',
     '11111111-1111-1111-1111-111111111111','M own laptop','active'),
    ('00000000-0000-0000-0000-000000000000','deac0000-0000-0000-0000-0000000000a2',
     '22222222-2222-2222-2222-222222222222','other user phone','active')
    on conflict do nothing;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","tenant_id":"00000000-0000-0000-0000-000000000000"}';
  do $$
  begin
    -- (a) own-vs-manage: a member WITHOUT device.manage sees ONLY their own device.
    if (select count(*) from device.devices) <> 1 then
      raise exception 'FAIL O3-4: member sees % devices (expected 1 — own only; devices_read leak reopened?)',
        (select count(*) from device.devices); end if;
    if (select count(*) from device.devices
          where profile_id='22222222-2222-2222-2222-222222222222') <> 0 then
      raise exception 'FAIL O3-4: member can read another user''s device (own-vs-manage broken)'; end if;
    if (select count(*) from device.devices
          where profile_id='11111111-1111-1111-1111-111111111111') <> 1 then
      raise exception 'FAIL O3-4: member cannot see their OWN device'; end if;

    -- (b) sync_policy is service_role-only — a direct client UPDATE is denied (SELECT-only grant),
    -- so the only write path is /rpc/devices/set-sync-policy (capability device.manage).
    begin
      update device.devices set sync_policy = '{"config_pull":"manual"}'::jsonb
        where id='deac0000-0000-0000-0000-0000000000a1';
      raise exception 'FAIL O3-4: member could UPDATE devices.sync_policy directly (bypassing /rpc)';
    exception when insufficient_privilege then null; end;

    raise notice 'O3-4 device fleet: member sees own device only + no direct sync_policy write ✓';
  end $$;
rollback;

-- 14. has_capability() resolves SHARED-DEFAULT grants (RW2 live-bug regression). Default-role
-- permissions are shared rows (tenant_id NULL) exposed per-tenant via effective_role_permissions;
-- has_capability MUST read that view, else a direct `role_permissions.tenant_id = tenant` join
-- never matches the NULL defaults and every capability resolves false (owner included).
begin;
  do $$
  declare
    t         uuid := '00000000-0000-0000-0000-000000000000';
    owner_p   uuid := 'e0e0e0e0-0000-0000-0000-0000000000a1';
    member_p  uuid := 'e0e0e0e0-0000-0000-0000-0000000000a2';
    owner_r   uuid := (select role_id from core.effective_roles where tenant_id = t and key = 'owner');
    member_r  uuid := (select role_id from core.effective_roles where tenant_id = t and key = 'member');
  begin
    insert into core.profiles(id) values (owner_p),(member_p) on conflict do nothing;
    insert into core.memberships(profile_id, tenant_id, status, active, assigned_by)
      values (owner_p,t,'active',true,'authz'),(member_p,t,'active',true,'authz') on conflict do nothing;
    insert into core.profile_roles(tenant_id, profile_id, role_id, assigned_by)
      values (t,owner_p,owner_r,'authz'),(t,member_p,member_r,'authz') on conflict do nothing;

    set local role authenticated;
    -- owner: holds device.manage via the shared-default owner role.
    set local request.jwt.claims = '{"sub":"e0e0e0e0-0000-0000-0000-0000000000a1","tenant_id":"00000000-0000-0000-0000-000000000000"}';
    if not core.has_capability('device.manage') then
      raise exception 'FAIL RW2: owner does NOT resolve device.manage — has_capability reads role_permissions not effective_role_permissions (shared-default bug reopened)'; end if;
    if core.has_capability('totally.bogus') then
      raise exception 'FAIL RW2: has_capability returned true for a nonexistent capability'; end if;
    reset role;
    -- member: does NOT hold device.manage (own-vs-manage must discriminate).
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"e0e0e0e0-0000-0000-0000-0000000000a2","tenant_id":"00000000-0000-0000-0000-000000000000"}';
    if core.has_capability('device.manage') then
      raise exception 'FAIL RW2: member wrongly resolves device.manage (own-vs-manage broken)'; end if;
    reset role;
    raise notice 'RW2 has_capability resolves shared-default grants (owner=device.manage ✓, member=✗, bogus=✗)';
  end $$;
rollback;

\echo 'ALL RW12 ADVERSARIAL AUTHZ TESTS PASSED'
