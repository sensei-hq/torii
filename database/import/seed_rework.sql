-- Per-tenant default budget root (C3). RBAC now seeds via import files as SHARED defaults
-- (core.capabilities + tenant_id-NULL core.roles / core.role_permissions) resolved through the
-- core.effective_* views — no per-tenant role copy. This after-script remains only for the budget
-- root, which is genuinely per-tenant. TODO: move to a core.tenants insert trigger, then drop this.
-- (after-script: run verbatim by dbd; plpgsql is fine here, unlike parsed ddl/ files.)
set search_path to core, public, extensions;

-- C3: default org budget node (the tenant-root budget; unlimited cap → always headroom). The C1
-- hot-path resolves budgets fail-closed, so every tenant needs at least this root or all inference
-- is denied; admins add capped children via /rpc/budgets/upsert-node. Idempotent (one root/tenant).
do $$
declare
  t record;
begin
  for t in select id from core.tenants loop
    insert into public.budget_nodes (tenant_id, kind, name, cap_amount, enforcement, modified_by)
    select t.id, 'org', 'Organization', null, 'hard', 'seed'
    where not exists (
      select 1 from public.budget_nodes b where b.tenant_id = t.id and b.parent_id is null
    );
  end loop;
end $$;
