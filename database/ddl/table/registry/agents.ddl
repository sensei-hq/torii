-- database/ddl/table/registry/agents.ddl
set search_path to registry, core, extensions;
-- TM-6 (torii#24): the tenant's agent definitions (serde agent def), published replace-all with
-- a registry.bump_generation in the same transaction.
create table if not exists agents (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, name         text        not null
, def          jsonb       not null
, modified_at  timestamptz not null default now()
, modified_by  text
, primary key (tenant_id, name)
);
comment on table agents is 'TM-6: orchestrator agent registry, per tenant. Service_role-write.';
