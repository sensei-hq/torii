-- Per-tenant default budget root (C3). RBAC now seeds via import files as SHARED defaults
-- (core.permissions + tenant_id-NULL core.roles / core.role_permissions) resolved through the
-- core.effective_* views — no per-tenant role copy. This after-script remains only for the budget
-- root, which is genuinely per-tenant. TODO: move to a core.tenants insert trigger, then drop this.
-- (after-script: run verbatim by dbd; plpgsql is fine here, unlike parsed ddl/ files.)
--
-- §D Phase 5 (org/budget split): the tenant root is now a core.org_units row (parent_id null, level 0)
-- + its uncapped hard governance.nodes cap (id == org_unit_id, DC-1) + the default per-tenant
-- unit_levels labels. The C1 hot path resolves budgets fail-closed, so every tenant needs at least this
-- root or all inference is denied; admins add capped children via /rpc/budgets/upsert-node.
set search_path to core, public, governance, extensions;

do $$
declare
  t      record;
  v_unit uuid;
begin
  for t in select id from core.tenants loop
    -- per-tenant org-tree tier labels (0=Organization … 4=Service). Idempotent.
    insert into core.unit_levels (tenant_id, level, label)
    select t.id, v.level, v.label
    from (values (0,'Organization'),(1,'Department'),(2,'Team'),(3,'Personal'),(4,'Service'))
           as v(level, label)
    on conflict (tenant_id, level) do nothing;

    -- the org root (parent_id null, level 0) + its uncapped hard node. One root/tenant (idempotent).
    if not exists (select 1 from core.org_units ou
                    where ou.tenant_id = t.id and ou.parent_id is null) then
      insert into core.org_units (tenant_id, parent_id, level, name, is_personal, modified_by)
      values (t.id, null, 0, 'Organization', false, 'seed')
      returning id into v_unit;

      insert into governance.nodes (tenant_id, id, org_unit_id, cap_amount, enforcement, modified_by)
      values (t.id, v_unit, v_unit, null, 'hard', 'seed');
    end if;
  end loop;
end $$;
