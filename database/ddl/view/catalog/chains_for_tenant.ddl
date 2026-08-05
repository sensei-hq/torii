-- database/ddl/view/catalog/chains_for_tenant.ddl
set search_path to catalog, core, keyvault, extensions;

-- §D §B ★ shield view (Phase 3): the single per-tenant resolved+viable+priced chain-model read
-- model. It supersedes public.effective_chain_models (tenant-override resolution) + public.
-- viable_chain_models (router-config filter), and is the source of truth for MODEL ENABLEMENT —
-- which is NOT a stored per-tenant toggle (model_overrides/tenant_model_state are RETIRED) but is
-- DERIVED from chain membership: a model is usable for a tenant iff it appears here. Also projects
-- the effective LIST price per step (model_endpoints); a per-tenant pricing-tier modifier is
-- deferred and applies HERE later as `list × modifier` (the ledger snapshots the effective cost, so
-- history never recomputes). Gateway-internal: read via the service_role pool, tenant-filtered; NOT
-- granted to authenticated (all-tenant rows, no security_invoker → a grant would be a PostgREST leak;
-- matches effective_chain_models).
create or replace view chains_for_tenant as
with resolved as (
  -- Tenant's own active chain models (override — takes precedence).
  select
    c.tenant_id
  , c.name                          as chain_name
  , c.capability_id
  , c.priority
  , c.max_fallback_attempts
  , c.circuit_breaker_threshold
  , c.circuit_breaker_window_minutes
  , cm.id                           as chain_model_id
  , cm.router_id
  , cm.model_id
  , cm.sequence_order
  , cm.max_retries
  , cm.is_active
  , cm.plane
  from catalog.chains c
  join catalog.chain_models cm
    on  cm.tenant_id         = c.tenant_id
    and cm.fallback_chain_id = c.id
  where c.is_active  = true
    and cm.is_active = true

  union all

  -- Platform chain models for chains the tenant has NOT overridden with an active chain (inherit).
  select
    t.id                            as tenant_id
  , pc.name                         as chain_name
  , pc.capability_id
  , pc.priority
  , pc.max_fallback_attempts
  , pc.circuit_breaker_threshold
  , pc.circuit_breaker_window_minutes
  , pcm.id                          as chain_model_id
  , pcm.router_id
  , pcm.model_id
  , pcm.sequence_order
  , pcm.max_retries
  , pcm.is_active
  , pcm.plane
  from core.tenants t
  cross join core.tenants pt          -- one platform tenant expected; cross join is safe
  join catalog.chains pc
    on  pc.tenant_id = pt.id
    and pc.is_active  = true
  join catalog.chain_models pcm
    on  pcm.tenant_id         = pt.id
    and pcm.fallback_chain_id = pc.id
    and pcm.is_active          = true
  where pt.is_platform = true
    and t.is_platform  = false        -- exclude platform tenant from inheriting its own chains
    and not exists (
      select 1 from catalog.chains c2
      where c2.tenant_id  = t.id
        and c2.name       = pc.name
        and c2.is_active  = true       -- inactive overrides transparently fall back to platform
    )
)
select
  r.tenant_id
, r.chain_name
, r.capability_id
, r.priority
, r.max_fallback_attempts
, r.circuit_breaker_threshold
, r.circuit_breaker_window_minutes
, r.chain_model_id
, r.sequence_order
, r.max_retries
, r.is_active
, r.plane
, r.router_id
, rt.name                              as router_name
, (rt.authentication_type <> 'none')   as router_requires_key
, r.model_id
, m.full_name                          as model_full_name
, m.display_name                       as model_display_name
, p.name                               as provider
  -- Effective LIST price for this (model, router, capability) step. One endpoint via a scalar
  -- subquery (never multiplies the step grain); a per-tenant tier modifier folds in here later.
, ( select me.cost_per_input_token
      from catalog.model_endpoints me
     where me.model_id      = r.model_id
       and me.router_id     = r.router_id
       and me.capability_id = r.capability_id
       and me.is_active     = true
     order by me.is_default desc nulls last, me.priority asc nulls last
     limit 1 )                         as cost_per_input_token
, ( select me.cost_per_output_token
      from catalog.model_endpoints me
     where me.model_id      = r.model_id
       and me.router_id     = r.router_id
       and me.capability_id = r.capability_id
       and me.is_active     = true
     order by me.is_default desc nulls last, me.priority asc nulls last
     limit 1 )                         as cost_per_output_token
from resolved r
join catalog.routers rt on rt.id = r.router_id
join catalog.models  m  on m.id  = r.model_id
left join catalog.providers p on p.id = m.provider_id
-- Keyless-safe viability guard: keep a step iff its router needs no key (local/ollama =
-- authentication_type 'none') OR the tenant has an active credential for that router. A keyless
-- local router with no credential row STAYS viable (the bug the old inner-join viable_chain_models
-- had); a key-requiring router the tenant hasn't connected is scrubbed out.
where rt.authentication_type = 'none'
   or exists (
     select 1 from keyvault.router_credentials rc
      where rc.tenant_id = r.tenant_id
        and rc.router_id = r.router_id
        and rc.is_active = true
   );

comment on view chains_for_tenant is
'Per-tenant resolved + viable + priced chain-model shield (§D §B, Phase 3). Consolidates
effective_chain_models (tenant-override resolution + platform inheritance) and viable_chain_models
(router-config filter, now keyless-safe). SOURCE OF TRUTH FOR MODEL ENABLEMENT — enablement is
chain membership, not a stored toggle (model_overrides/tenant_model_state retired). Projects the
effective list price per step; per-tenant pricing-tier modifier applies here later. Gateway-internal;
never grant to authenticated.';
