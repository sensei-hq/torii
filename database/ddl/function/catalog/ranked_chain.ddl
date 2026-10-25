-- database/ddl/function/catalog/ranked_chain.ddl
set search_path to catalog, core, extensions;

-- The ordered, tenant-scoped candidate list for one (tenant, capability,
-- category): every chain step from catalog.chains_for_tenant, ordered by the
-- measured ranking where a winner exists and by chain sequence everywhere else.
--
-- A set-returning function rather than a view because it takes the three
-- arguments the resolver has; call it as
--   select * from catalog.ranked_chain(tenant, 'decision', 'planner.select').
--
-- Contract:
-- - chain rows are ALWAYS present (an unranked category still yields the chain,
--   `rank`/`verdict`/`within_margin` NULL and `rank` NULLS LAST);
-- - `rank` is non-NULL only for a `winner`, so a tie cannot be read as an order;
-- - `within_margin` is reserved for the Phase 4 margin rule and is NULL here;
-- - tenant scope comes from chains_for_tenant, so the caller passes the tenant
--   and never filters rows itself. Gateway-internal: EXECUTE is service_role
--   only, matching chains_for_tenant (no PostgREST leak to authenticated).
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
, within_margin          numeric
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
       , null::numeric             as within_margin
       , r.revision
       , r.artifact_sha
       , r.corpus_sha
       , r.generated_at
    from chain c
    join catalog.models m
      on m.id = c.model_id
    left join catalog.model_rankings r
      on r.category = p_category
     and r.model_id = c.model_id
)
select *
  from resolved
 order by resolved.rank nulls last
        , resolved.sequence_order
$$;

comment on function ranked_chain(uuid, text, text) is
'Ordered, tenant-scoped chain candidates for one (tenant, capability, category) (System One
Phase 3). Chain rows always come back; `rank` is set only for a `winner`, NULL for a tie or an
unranked category, and `within_margin` is reserved for the Phase 4 margin rule. Reads
catalog.chains_for_tenant (no RLS) and catalog.model_rankings; service_role only.';

revoke all on function ranked_chain(uuid, text, text) from public;
grant execute on function ranked_chain(uuid, text, text) to service_role;
