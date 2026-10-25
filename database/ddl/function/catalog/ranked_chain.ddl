-- database/ddl/function/catalog/ranked_chain.ddl
set search_path to catalog, core, extensions;

-- The ordered, tenant-scoped candidate list for one (tenant, capability, category):
-- every chain step from catalog.chains_for_tenant, ordered by the measured ranking
-- where a winner exists and by chain sequence everywhere else — with the quality
-- margin (§System One Phase 4a) applied as a MEMBERSHIP test, never as a re-order.
--
-- A set-returning function rather than a view because it takes the three arguments the
-- resolver has; call it as
--   select * from catalog.ranked_chain(tenant, 'decision', 'planner.select').
--
-- Contract:
-- - chain rows are ALWAYS present (an unranked category still yields the chain,
--   `rank`/`accuracy`/`within_margin` NULL and `rank` NULLS LAST);
-- - `rank` is non-NULL only for a `winner`, so a tie cannot be read as an order;
-- - `within_margin` is a claim, so it is non-NULL only for a `winner`: true when the
--   model's accuracy is within `effective_margin` of the category's TOP model
--   (available or not — two tenants with different availability share one definition
--   of "good", only their survivors differ);
-- - the margin decides membership, never position: admissible rows keep artifact rank;
-- - a model outside the margin is still a chain candidate — an authored fallback can
--   beat failing the run, it just never leads on measurement;
-- - `effective_margin` and `policy_revision` are reported on every row, so a call can
--   be re-derived after the fact; `revision`/`artifact_sha`/`corpus_sha` are the
--   ranking's own provenance;
-- - tenant scope comes from chains_for_tenant, so the caller passes the tenant and
--   never filters rows itself. Gateway-internal: EXECUTE is service_role only,
--   matching chains_for_tenant (no PostgREST leak to authenticated).
create or replace function ranked_chain(
  p_tenant     uuid
, p_capability text
, p_category   text
)
returns table (
  tenant_id              uuid
, chain_name             varchar
, capability_id          uuid
, chain_model_id         uuid
, sequence_order         integer
, router_id              uuid
, router_name            varchar
, router_model_id        varchar
, model_id               uuid
, model_full_name        varchar
, provider               varchar
, plane                  core.execution_location
, context_window         integer
, cost_per_input_token   numeric
, cost_per_output_token  numeric
, category               text
, rank                   integer
, verdict                catalog.verdict
, within_margin          boolean
, effective_margin       numeric
, policy_revision        bigint
, accuracy               numeric
, ci_half_width          numeric
, measured               boolean
, proxy                  text
, revision               bigint
, artifact_sha           text
, corpus_sha             text
, generated_at           timestamp with time zone
)
language sql
stable
as
$$
with chain as (
  select c.*
    from catalog.chains_for_tenant c
    join catalog.capability_types ct
      on ct.id = c.capability_id
   where c.tenant_id = p_tenant
     and ct.name     = p_capability
)
-- Every ranked model for the category, with its CI half-width precomputed. All rows
-- of a category share one verdict, one artifact and one generation time.
, ranking as (
  select r.*
       , (r.ci_hi - r.ci_lo) / 2 as half_width
    from catalog.model_rankings r
   where r.category = p_category
)
-- The category's top model — the reference point the margin is measured against. It
-- need not be on this tenant's chain: "good" is a property of the measurement.
, top as (
  select r.accuracy, r.half_width
    from ranking r
   where r.rank = 1
)
-- The margin in force: the tenant's row wins over the platform default, and a missing
-- row means the 0.03 default. `revision` stays NULL when no row exists, so the trace
-- can tell "default" from "an edited policy that happens to be 0.03".
, policy as (
  select max(p.margin)   filter (where p.tenant_id = p_tenant) as tenant_margin
       , max(p.margin)   filter (where p.tenant_id is null)    as default_margin
       , max(p.revision) filter (where p.tenant_id = p_tenant) as tenant_revision
       , max(p.revision) filter (where p.tenant_id is null)    as default_revision
    from catalog.ranking_policies p
   where p.category = p_category
     and (p.tenant_id = p_tenant or p.tenant_id is null)
)
, limits as (
  select coalesce(policy.tenant_margin, policy.default_margin, 0.03) as margin
       , coalesce(policy.tenant_revision, policy.default_revision)   as policy_revision
       , top.accuracy                                                as top_accuracy
         -- A tolerance finer than the measurement's own uncertainty is not a claim
         -- anyone can keep, so the CI half-width is a floor on the margin.
       , greatest(coalesce(policy.tenant_margin, policy.default_margin, 0.03)
                , coalesce(top.half_width, 0))                       as effective_margin
    from policy
    left join top on true
)
, resolved as (
  select c.tenant_id
       , c.chain_name
       , c.capability_id
       , c.chain_model_id
       , c.sequence_order
       , c.router_id
       , c.router_name
       -- The API model id: one endpoint per (model, router, capability), so a
       -- lateral scalar cannot multiply the chain step's grain.
       , (select me.router_model_id
            from catalog.model_endpoints me
           where me.model_id      = c.model_id
             and me.router_id     = c.router_id
             and me.capability_id = c.capability_id
             and me.is_active     = true
           order by me.is_default desc nulls last, me.priority asc nulls last
           limit 1)                    as router_model_id
       , c.model_id
       , c.model_full_name
       , c.provider
       , c.plane
       , m.context_window
       , c.cost_per_input_token
       , c.cost_per_output_token
       , p_category                as category
       , r.rank
       , r.verdict
       , case
           when r.verdict = 'winner' and r.model_id is not null
             then r.accuracy >= limits.top_accuracy - limits.effective_margin
         end                       as within_margin
       , limits.effective_margin
       , limits.policy_revision
       , r.accuracy
       , r.half_width              as ci_half_width
       , (r.model_id is not null)  as measured
       , r.proxy
       , r.revision
       , r.artifact_sha
       , r.corpus_sha
       , r.generated_at
    from chain c
    join catalog.models m
      on m.id = c.model_id
    left join ranking r
      on r.model_id = c.model_id
    cross join limits
)
select *
  from resolved
 order by resolved.rank nulls last
        , resolved.sequence_order
$$;

comment on function ranked_chain(uuid, text, text) is
'Ordered, tenant-scoped chain candidates for one (tenant, capability, category) (System One
Phase 3 + 4). Chain rows always come back; `rank` is set only for a `winner`, NULL for a tie or
an unranked category. `within_margin` applies the quality margin as a membership test —
accuracy within `effective_margin` = greatest(configured margin, top model CI half-width) of the
category''s top model — and is NULL whenever there is no order to claim. The margin never
reorders: admissible rows keep artifact rank. `effective_margin`, `policy_revision` and the
ranking''s revision/artifact_sha/corpus_sha travel with every row so a call can be re-derived.
Reads catalog.chains_for_tenant (no RLS) + catalog.model_rankings + catalog.ranking_policies;
service_role only.';

revoke all on function ranked_chain(uuid, text, text) from public;
grant execute on function ranked_chain(uuid, text, text) to service_role;
