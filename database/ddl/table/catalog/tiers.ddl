-- database/ddl/table/catalog/tiers.ddl
set search_path to catalog, core, extensions;

-- G2 (gateway SP-CAT "tiers & chains"): a TIER is a named catalog segment with an intra-tier
-- routing strategy. Tiers and chains are ORTHOGONAL axes that compose — a chain is an ordered
-- list of tier-refs (catalog.chain_models.tier_id) or concrete models.
--
-- Membership is CURATED ∪ ATTRIBUTE-DERIVED, resolved by catalog.effective_tier_models:
--   · curated  → explicit rows in catalog.tier_models
--   · derived  → every derive_* dimension this row constrains
-- That union is what buys "add a model to a tier and every chain referencing it updates",
-- with no chain edit.
--
-- Tenancy mirrors catalog.chains: the platform tenant holds the defaults and a tenant
-- overrides by declaring a tier with the same name. RLS-covered via tenant_isolation.sql.
create table if not exists tiers (
  tenant_id            uuid        not null
    references core.tenants(id) on delete cascade
, id                   uuid        not null default gen_random_uuid()
, name                 varchar(100) not null
, strategy             intra_tier_strategy not null default 'priority'
  -- ── attribute-derived membership ────────────────────────────────────────────────────
  -- Each dimension is a SET the model's attribute must be IN; dimensions AND together.
  -- NULL or empty = DO NOT FILTER on this dimension (not "match nothing") — see
  -- catalog.effective_tier_models. A row constraining NO dimension derives nothing at all,
  -- so a purely curated tier cannot silently swallow the catalog.
, derive_auth_types    model_auth_type[]
, derive_cost_bands    cost_band[]
, derive_free_types    free_type[]
, derive_localities    core.execution_location[]
  -- Overlap (&&), not containment: any shared tag matches.
, derive_tags          text[]
  -- Single capability by design; a tier is normally scoped within one. Widening to a set is
  -- a later reshape, not an array-FK (Postgres cannot enforce those).
, derive_capability_id uuid
    references capability_types(id)
, is_active            boolean     not null default true
, description          text
, created_at           timestamptz not null default now()
, modified_at          timestamptz not null default now()
, modified_by          varchar     not null
, primary key (tenant_id, id)
);

create unique index if not exists tiers_tenant_name_ukey on tiers(tenant_id, name);
create index if not exists tiers_active_idx on tiers(tenant_id, is_active);

comment on table tiers is
'Named catalog segments with an intra-tier ordering strategy (gateway SP-CAT).
- Membership = curated (catalog.tier_models) UNION attribute-derived (derive_* columns)
- An empty/NULL derive_* dimension does not filter; a tier constraining none derives nothing
- Resolved by catalog.effective_tier_models
- Platform tenant holds defaults; a tenant overrides by name (same rule as catalog.chains)';
