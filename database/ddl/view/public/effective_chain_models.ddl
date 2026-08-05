-- database/ddl/view/public/effective_chain_models.ddl
set search_path to public, core, extensions;

create or replace view public.effective_chain_models as

-- Tenant's own active chain models (override — takes precedence)
select
  fc.tenant_id
, fc.name                         as chain_name
, fc.capability_id
, fc.max_fallback_attempts
, fc.circuit_breaker_threshold
, fc.circuit_breaker_window_minutes
, fc.priority
, fcm.id                          as chain_model_id
, fcm.router_id
, fcm.model_id
, fcm.sequence_order
, fcm.max_retries
, fcm.is_active
, fcm.plane
from catalog.chains fc
join catalog.chain_models fcm
  on  fcm.tenant_id         = fc.tenant_id
  and fcm.fallback_chain_id = fc.id
where fc.is_active  = true
  and fcm.is_active = true

union all

-- Platform chain models for chains the tenant has NOT overridden with an active chain
select
  t.id                              as tenant_id
, pfc.name                          as chain_name
, pfc.capability_id
, pfc.max_fallback_attempts
, pfc.circuit_breaker_threshold
, pfc.circuit_breaker_window_minutes
, pfc.priority
, pfcm.id                           as chain_model_id
, pfcm.router_id
, pfcm.model_id
, pfcm.sequence_order
, pfcm.max_retries
, pfcm.is_active
, pfcm.plane
from core.tenants t
cross join core.tenants pt          -- one platform tenant expected; cross join is safe
join catalog.chains pfc
  on  pfc.tenant_id = pt.id
  and pfc.is_active  = true
join catalog.chain_models pfcm
  on  pfcm.tenant_id         = pt.id
  and pfcm.fallback_chain_id = pfc.id
  and pfcm.is_active          = true
where pt.is_platform = true
  and t.is_platform  = false        -- exclude platform tenant from inheriting its own chains
  and not exists (
    select 1
    from catalog.chains fc2
    where fc2.tenant_id  = t.id
      and fc2.name       = pfc.name
      and fc2.is_active  = true     -- inactive overrides fall back to platform chain
  );

comment on view public.effective_chain_models is
'Resolves the effective fallback chain models per tenant.
- Tenant owns an active chain by name → that chain is used (override)
- No active tenant chain with that name → platform tenant chain is used (inherit)
- Inactive tenant overrides transparently fall back to the platform chain
- Filter by tenant_id + chain_name to get one chain sequence';
