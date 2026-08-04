-- database/ddl/table/public/fallback_chain_models.ddl
set search_path to public, core, config, extensions;

create table if not exists fallback_chain_models (
  tenant_id          uuid    not null
    references core.tenants(id) on delete cascade
, id                 uuid    not null default gen_random_uuid()
, fallback_chain_id  uuid    not null
, router_id          uuid    not null references catalog.routers(id)
, model_id           uuid    not null references catalog.models(id)
, sequence_order     integer not null
, max_retries        integer not null default 1
, is_active          boolean not null default true
, plane              core.execution_location not null default 'cloud'  -- {local,cloud} enum
, created_at         timestamptz not null default now()
, modified_at        timestamptz not null default now()
, modified_by        varchar not null
, primary key (tenant_id, id)
, foreign key (tenant_id, fallback_chain_id)
    references fallback_chains(tenant_id, id) on delete cascade
);

create unique index if not exists fallback_chain_models_seq_ukey
  on fallback_chain_models(tenant_id, fallback_chain_id, sequence_order);

create index if not exists fallback_chain_models_chain_idx
  on fallback_chain_models(tenant_id, fallback_chain_id);

create index if not exists fallback_chain_models_router_idx
  on fallback_chain_models(tenant_id, router_id);

create index if not exists fallback_chain_models_model_idx
  on fallback_chain_models(tenant_id, model_id);

comment on table fallback_chain_models is
'Ordered router-model sequence for tenant fallback chains.
- tenant_id: partition key matching parent fallback_chains row
- Composite FK to fallback_chains(tenant_id, id) ensures cross-tenant safety
- sequence_order defines fallback priority within the chain
- plane: which execution plane this step runs on (cloud = central gateway, local = on-device)';
