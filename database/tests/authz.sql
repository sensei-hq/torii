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

    -- 2. Self budget-raise: UPDATE budget_nodes.cap → DENIED (SELECT-only).
    begin
      update public.budget_nodes set cap_amount = 999999;
      raise exception 'FAIL budget: member could UPDATE budget_nodes.cap_amount';
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
      insert into public.audit_events(tenant_id, actor_id, action)
        values ('00000000-0000-0000-0000-000000000000','99999999-9999-9999-9999-999999999999','forged');
      raise exception 'FAIL audit: member could forge actor_id on an audit event';
    exception when check_violation or insufficient_privilege then null; end;

    -- 6. API keys are not client-writable (issuance is a service_role gateway
    -- action; only a hash+prefix is ever stored, never the raw key).
    begin
      insert into public.api_keys(tenant_id, profile_id, hashed_secret, prefix)
        values ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','h','sk_x');
      raise exception 'FAIL apikey: member could INSERT api_keys';
    exception when insufficient_privilege then null; end;

    -- 7. Chain tamper: UPDATE fallback_chains → DENIED (SELECT-only).
    begin
      update public.fallback_chains set name = 'x';
      raise exception 'FAIL chain: member could UPDATE fallback_chains';
    exception when insufficient_privilege then null; end;

    raise notice 'RW12 authenticated adversarial writes: all DENIED ✓';
  end $$;
rollback;

-- 8. anon cannot write config.feature_states (the closed RW6 hole).
begin;
  set local role anon;
  do $$
  begin
    begin
      insert into config.feature_states(feature_id, user_id, enabled)
        values ((select id from config.features limit 1), 'anon-attacker', true);
      raise exception 'FAIL feature_states: anon could INSERT config.feature_states';
    exception when insufficient_privilege then null; end;
    raise notice 'RW12 anon feature_states write: DENIED ✓';
  end $$;
rollback;

-- 9. Anti-escalation subset guard (HIGH #3): `/rpc/rbac/assign-role` refuses to
-- grant a role whose capabilities are NOT a subset of the actor's own. Proven here
-- as the data invariant the gateway guard relies on: `owner`'s capabilities are NOT
-- a subset of `admin`'s (admin holds `role.manage` but NOT `tenant.manage`), so an
-- admin assigning `owner` (to self or anyone) hits assigned ⊄ actor → 403.
begin;
  do $$
  declare
    t          uuid := '00000000-0000-0000-0000-000000000000';
    owner_role uuid := (select id from core.roles where tenant_id = t and key = 'owner');
    admin_role uuid := (select id from core.roles where tenant_id = t and key = 'admin');
    escalating int;
  begin
    -- Capabilities `owner` grants that `admin` does not → the subset check denies them.
    select count(*) into escalating
      from core.role_permissions o
     where o.role_id = owner_role and o.tenant_id = t
       and not exists (
         select 1 from core.role_permissions a
          where a.role_id = admin_role and a.tenant_id = t
            and a.capability = o.capability);
    if escalating = 0 then
      raise exception 'FAIL escalation-subset: owner adds no capability beyond admin — guard would wrongly ALLOW admin→owner';
    end if;
    -- The canonical escalation cap must be owner-only (admin cannot self-grant it).
    if not exists (select 1 from core.role_permissions
                     where role_id = owner_role and tenant_id = t and capability = 'tenant.manage')
       or exists (select 1 from core.role_permissions
                    where role_id = admin_role and tenant_id = t and capability = 'tenant.manage') then
      raise exception 'FAIL escalation-subset: tenant.manage is not owner-only as expected';
    end if;
    raise notice 'RW12 anti-escalation subset: admin CANNOT gain tenant.manage via owner (owner ⊄ admin) ✓';
  end $$;
rollback;

\echo 'ALL RW12 ADVERSARIAL AUTHZ TESTS PASSED'
