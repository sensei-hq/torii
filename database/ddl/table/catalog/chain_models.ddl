-- database/ddl/table/catalog/chain_models.ddl
set search_path to catalog, core, extensions;

-- §D rename+move: catalog.chain_models → catalog.chain_models (db-redesign.md §99). The
-- `fallback_chain_id` column name is kept for now (chain_id rename deferred with other reshapes).
create table if not exists chain_models (
  tenant_id          uuid    not null
    references core.tenants(id) on delete cascade
, id                 uuid    not null default gen_random_uuid()
, fallback_chain_id  uuid    not null
  -- G2: a step is a CONCRETE model (router_id + model_id) XOR a TIER-REF (tier_id).
  -- Both were NOT NULL before tier-refs existed; the step-kind CHECK below preserves that
  -- invariant for concrete steps while allowing a tier-ref to carry neither.
, router_id          uuid    references catalog.routers(id)
, model_id           uuid    references catalog.models(id)
  -- Tier-ref: the tier's members expand, in its own intra-tier strategy order, at this
  -- position in the chain. This is what makes "add a model to a tier and every chain
  -- referencing it updates" true without editing any chain.
, tier_id            uuid
, sequence_order     integer not null
, max_retries        integer not null default 1
, is_active          boolean not null default true
, plane              core.execution_location not null default 'cloud'  -- {local,cloud} enum
, created_at         timestamptz not null default now()
, modified_at        timestamptz not null default now()
, modified_by        varchar not null
, primary key (tenant_id, id)
, foreign key (tenant_id, fallback_chain_id)
    references chains(tenant_id, id) on delete cascade
, foreign key (tenant_id, tier_id)
    references tiers(tenant_id, id) on delete cascade
  -- G2: exactly one step kind. A concrete step needs BOTH router and model (the pre-tier
  -- invariant); a tier-ref needs neither. Both-at-once and neither-at-all are rejected, so
  -- a half-written step cannot reach the config loader and resolve to nothing at run time.
, constraint chain_models_step_kind_check check (
    (tier_id is null and router_id is not null and model_id is not null)
    or (tier_id is not null and router_id is null and model_id is null))
);

create unique index if not exists chain_models_seq_ukey
  on chain_models(tenant_id, fallback_chain_id, sequence_order);

create index if not exists chain_models_chain_idx
  on chain_models(tenant_id, fallback_chain_id);

create index if not exists chain_models_router_idx
  on chain_models(tenant_id, router_id);

create index if not exists chain_models_model_idx
  on chain_models(tenant_id, model_id);

comment on table chain_models is
'Ordered step sequence for tenant fallback chains: each step is a concrete router+model
XOR a tier-ref (tier_id → catalog.tiers).

⚠ TIER-REF STEPS ARE NOT YET HONOURED BY THE CONFIG LOADER. services/gateway/src/config_loader.rs
inner-joins catalog.routers and catalog.models on router_id/model_id, so a tier-ref step (both
NULL) is silently DROPPED from the assembled GatewayConfig — the chain loses that position with
no error. Expanding tier-refs through catalog.effective_tier_models is the first task of the
loader-wiring increment; until then, only concrete steps reach the engine.
- tenant_id: partition key matching parent catalog.chains row
- Composite FK to catalog.chains(tenant_id, id) ensures cross-tenant safety
- sequence_order defines fallback priority within the chain
- plane: which execution plane this step runs on (cloud = central gateway, local = on-device)';
