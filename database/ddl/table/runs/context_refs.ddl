-- database/ddl/table/runs/context_refs.ddl
set search_path to runs, core, extensions;
-- TM-6 (torii#24): the scoped blackboard. Scope::Run → (run_id, 'run', ''), Scope::Node →
-- (run_id, 'node', node_path). run_id is load-bearing: without it a run-scoped key is global to
-- the deployment and a re-run of the same graph collides on its first node (gateway SP-OPS-1.1).
create table if not exists context_refs (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, run_id      uuid        not null
, scope_kind  text        not null
, scope_id    text        not null
, ctx_key     text        not null
, ctx_ref     jsonb       not null
, created_at  timestamptz not null default now()
, primary key (tenant_id, run_id, scope_kind, scope_id, ctx_key)
);
comment on table context_refs is 'TM-6: run/node-scoped blackboard entries (serde ContextRef → cas digest). Service_role-write.';
