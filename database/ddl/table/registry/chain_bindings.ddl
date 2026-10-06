-- database/ddl/table/registry/chain_bindings.ddl
set search_path to registry, core, extensions;
-- TM-6 (torii#24): (area, kind) → gateway chain NAME for the orchestrator's planner/agents. Kept
-- apart from catalog.chain_bindings (capability → chain id, per space/role) until the two are
-- reconciled; the boot check verifies every name resolves in the gateway's chains.
create table if not exists chain_bindings (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, area         text        not null
, kind         text        not null
, chain        text        not null
, modified_at  timestamptz not null default now()
, modified_by  text
, primary key (tenant_id, area, kind)
);
comment on table chain_bindings is 'TM-6: orchestrator (area, kind) → chain name bindings, per tenant. Service_role-write.';
