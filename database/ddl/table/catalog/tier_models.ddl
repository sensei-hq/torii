-- database/ddl/table/catalog/tier_models.ddl
set search_path to catalog, core, extensions;

-- G2: CURATED tier membership — the explicit half of catalog.tiers' curated ∪ derived union.
-- A model listed here belongs to the tier regardless of its attributes, so an operator can
-- pin a model a predicate would miss (or exclude-by-omission from a derived-only tier).
create table if not exists tier_models (
  tenant_id  uuid    not null
    references core.tenants(id) on delete cascade
, id         uuid    not null default gen_random_uuid()
, tier_id    uuid    not null
, model_id   uuid    not null references models(id) on delete cascade
, created_at timestamptz not null default now()
, primary key (tenant_id, id)
  -- Composite FK: a tier row can only be curated by its OWN tenant.
, foreign key (tenant_id, tier_id) references tiers(tenant_id, id) on delete cascade
);

create unique index if not exists tier_models_ukey on tier_models(tenant_id, tier_id, model_id);
create index if not exists tier_models_tier_idx on tier_models(tenant_id, tier_id);
create index if not exists tier_models_model_idx on tier_models(tenant_id, model_id);

comment on table tier_models is
'Curated tier membership (gateway SP-CAT). Unioned with attribute-derived membership by
catalog.effective_tier_models; curated wins the `source` label when a model is both.';
