-- database/ddl/table/catalog/chain_bindings.ddl
set search_path to catalog, core, extensions;
-- RW14 (C2): bind a named chain to a capability, scoped per space/role.
create table if not exists chain_bindings (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, id          uuid        not null default gen_random_uuid()
, capability  varchar(40) not null
, chain_id    uuid        not null
, space_id    uuid
, role_id     uuid
, created_at  timestamptz not null default now()
, primary key (tenant_id, id)
, foreign key (tenant_id, chain_id) references chains(tenant_id, id) on delete cascade
);
create index if not exists idx_chain_bindings_scope on chain_bindings(tenant_id, capability, space_id, role_id);
comment on table chain_bindings is 'RW14: named chain ↔ capability ↔ (space/role) binding. Service_role-write.';
