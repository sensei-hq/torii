-- RW11: seed the RBAC substrate — the closed capability set (F2 §4.3), the six
-- system roles per tenant, and their default grants. Runs after loader.sql.
-- Idempotent (on conflict do nothing).

set search_path to core, public, extensions;

-- (1) Closed capability catalog (F2 §4.3 / DECISIONS §5a).
insert into core.capabilities (key, domain, description) values
  ('budget.read','budget','View budgets and spend'),
  ('budget.write','budget','Create/edit budget nodes; approve requests'),
  ('budget.request','budget','Request a budget increase on an attributed node'),
  ('chain.read','routing','View chains/bindings/policies'),
  ('chain.write','routing','Create/edit chains, bindings, routing policy'),
  ('connection.manage','credentials','Connect/rotate/revoke provider credentials'),
  ('model.manage','catalog','Add/enable models; edit pricing/overrides'),
  ('space.create','knowledge','Create spaces'),
  ('space.join','knowledge','Join a space'),
  ('doc.read','knowledge','Read documents (subject to classification)'),
  ('doc.write','knowledge','Create/edit own documents'),
  ('doc.delete','knowledge','Delete documents / retire chunks'),
  ('doc.declassify','knowledge','Lower a document classification'),
  ('retrieval.manage','knowledge','Promote space retrieval/chunking defaults'),
  ('dataset.manage','knowledge','Manage structured datasets + column sensitivity'),
  ('dataset.compute','knowledge','Run compute-without-exposing over a dataset'),
  ('member.manage','org','Invite/place/manage members'),
  ('role.manage','org','Create roles; assign capabilities/roles'),
  ('apikey.manage','org','Issue/rotate/revoke API keys + service accounts'),
  ('tenant.manage','org','Manage tenant settings + verified domains'),
  ('mcp.manage','tools','Register MCP servers + tool allow-lists'),
  ('governance.manage','governance','Edit masking/retention/redaction/classification/features'),
  ('feature.manage','governance','Set feature-governance state'),
  ('device.manage','ops','Manage/revoke enrolled devices'),
  ('audit.read','observability','Read the audit ledger'),
  ('audit.export','observability','Export filtered ledger/audit data'),
  ('analytics.read','observability','Read analytics dashboards')
on conflict (key) do nothing;

-- (2) Per-tenant system roles + default grants.
do $$
declare
  t record;
  r_owner uuid; r_admin uuid; r_editor uuid; r_viewer uuid; r_member uuid; r_service uuid;
begin
  for t in select id from core.tenants loop
    -- system roles (idempotent by (tenant_id, key))
    insert into core.roles (tenant_id, key, name, is_system) values
      (t.id,'owner','Owner',true),(t.id,'admin','Administrator',true),
      (t.id,'editor','Editor',true),(t.id,'viewer','Viewer',true),
      (t.id,'member','Member',true),(t.id,'service','Service',true)
    on conflict (tenant_id, key) do nothing;

    select id into r_owner   from core.roles where tenant_id=t.id and key='owner';
    select id into r_admin   from core.roles where tenant_id=t.id and key='admin';
    select id into r_editor  from core.roles where tenant_id=t.id and key='editor';
    select id into r_viewer  from core.roles where tenant_id=t.id and key='viewer';
    select id into r_member  from core.roles where tenant_id=t.id and key='member';
    select id into r_service from core.roles where tenant_id=t.id and key='service';

    -- owner: every capability
    insert into core.role_permissions (tenant_id, role_id, capability)
      select t.id, r_owner, key from core.capabilities
    on conflict do nothing;

    -- admin: everything except tenant.manage (ownership-level)
    insert into core.role_permissions (tenant_id, role_id, capability)
      select t.id, r_admin, key from core.capabilities where key <> 'tenant.manage'
    on conflict do nothing;

    -- editor: content + read
    insert into core.role_permissions (tenant_id, role_id, capability) values
      (t.id,r_editor,'doc.read'),(t.id,r_editor,'doc.write'),(t.id,r_editor,'doc.delete'),
      (t.id,r_editor,'space.create'),(t.id,r_editor,'space.join'),(t.id,r_editor,'budget.read'),
      (t.id,r_editor,'chain.read'),(t.id,r_editor,'analytics.read'),(t.id,r_editor,'dataset.manage'),
      (t.id,r_editor,'budget.request')
    on conflict do nothing;

    -- viewer: read-only
    insert into core.role_permissions (tenant_id, role_id, capability) values
      (t.id,r_viewer,'doc.read'),(t.id,r_viewer,'budget.read'),(t.id,r_viewer,'chain.read'),
      (t.id,r_viewer,'analytics.read')
    on conflict do nothing;

    -- member: basic use
    insert into core.role_permissions (tenant_id, role_id, capability) values
      (t.id,r_member,'doc.read'),(t.id,r_member,'doc.write'),(t.id,r_member,'space.join'),
      (t.id,r_member,'budget.read'),(t.id,r_member,'budget.request')
    on conflict do nothing;

    -- service: programmatic inference (read + doc read); no admin caps
    insert into core.role_permissions (tenant_id, role_id, capability) values
      (t.id,r_service,'doc.read'),(t.id,r_service,'budget.read')
    on conflict do nothing;

    -- C3: default org budget node (the tenant-root budget; unlimited cap → always
    -- headroom). The C1 hot-path resolves budgets fail-closed, so every tenant needs
    -- at least this root or all inference is denied; admins add capped children
    -- (dept/team/user) via /rpc/budgets/upsert-node. Idempotent (one root per tenant).
    insert into public.budget_nodes (tenant_id, kind, name, cap_amount, enforcement, modified_by)
    select t.id, 'org', 'Organization', null, 'hard', 'seed'
    where not exists (
      select 1 from public.budget_nodes b where b.tenant_id = t.id and b.parent_id is null
    );
  end loop;
end $$;
