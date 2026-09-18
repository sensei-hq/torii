-- database/ddl/view/catalog/effective_tier_models.ddl
set search_path to catalog, core, extensions;

-- G2: resolve tier membership — CURATED ∪ ATTRIBUTE-DERIVED — to one row per
-- (tier, model). This is the view the config loader reads to expand a chain's tier-refs
-- into ordered candidates.
--
-- Two "absent" rules, both load-bearing and both pinned by tests/catalog_tiers.sql:
--
--   1. An EMPTY or NULL derive_* dimension DOES NOT FILTER. `{}` means "any auth type",
--      not "no auth type matches". Treating it as a filter would empty every tier that
--      constrains only one dimension.
--
--   2. A tier constraining NO dimension derives NOTHING. Without the has_derivation guard
--      every predicate below is vacuously true, so a purely curated tier would match the
--      entire catalog — populated-looking and routing wrongly.
--
-- Curated wins the `source` label when a model is both, so an operator can see which
-- members are pinned and which would disappear if an attribute changed.
create or replace view catalog.effective_tier_models as
select
  t.tenant_id
, t.id                          as tier_id
, t.name                        as tier_name
, t.strategy
, t.is_active                   as tier_is_active
, m.id                          as model_id
, m.full_name                   as model_full_name
, m.provider_id
, case when tm.model_id is not null then 'curated' else 'derived' end as source
from catalog.tiers t
cross join catalog.models m
left join catalog.tier_models tm
  on  tm.tenant_id = t.tenant_id
  and tm.tier_id   = t.id
  and tm.model_id  = m.id
where
  -- curated half
  tm.model_id is not null
  -- derived half
  or (
    -- rule 2: at least one dimension must be constrained
    (
      coalesce(cardinality(t.derive_auth_types), 0) > 0
      or coalesce(cardinality(t.derive_cost_bands), 0) > 0
      or coalesce(cardinality(t.derive_free_types), 0) > 0
      or coalesce(cardinality(t.derive_localities), 0) > 0
      or coalesce(cardinality(t.derive_tags), 0) > 0
      or t.derive_capability_id is not null
    )
    -- rule 1: an unconstrained dimension is skipped, not failed
    and (coalesce(cardinality(t.derive_auth_types), 0) = 0
         or m.model_auth_type = any (t.derive_auth_types))
    and (coalesce(cardinality(t.derive_cost_bands), 0) = 0
         or m.cost_band = any (t.derive_cost_bands))
    and (coalesce(cardinality(t.derive_free_types), 0) = 0
         or m.free_type = any (t.derive_free_types))
    and (coalesce(cardinality(t.derive_localities), 0) = 0
         or m.locality = any (t.derive_localities))
    -- overlap, not containment: any shared tag matches
    and (coalesce(cardinality(t.derive_tags), 0) = 0
         or m.tags && t.derive_tags)
    -- `supported` matters: an unsupported capability row must not confer membership
    and (t.derive_capability_id is null
         or exists (select 1 from catalog.model_capabilities mc
                     where mc.model_id = m.id
                       and mc.capability_id = t.derive_capability_id
                       and mc.supported))
  );

comment on view catalog.effective_tier_models is
'Resolved tier membership: curated (catalog.tier_models) UNION attribute-derived (tiers.derive_*),
one row per (tier, model), `source` labelling which half claimed it (curated wins ties).
An empty/NULL derive_* dimension does not filter; a tier constraining none derives nothing.';
