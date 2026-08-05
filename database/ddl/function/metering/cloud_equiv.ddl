set search_path to metering, public, config, core, extensions;

-- O2 §8 (bullet 1) / §6 flow-3 — the cloud-equivalent savings baseline. For a chain,
-- price the call's ACTUAL tokens at the CHEAPEST cloud step bound in that chain (the
-- conservative counterfactual — the cheapest cloud model the router would have fallen
-- through to had the local plane been unavailable). Returns:
--   cloud_equiv_usd — Σ token·rate at the cheapest priced cloud step (0 if none)
--   is_local_only   — chain has NO cloud step → no counterfactual (not inflated)
--   is_unpriced     — chain HAS a cloud step but none has a priced endpoint → excluded,
--                     surfaced as a data-quality count, NEVER guessed
-- Chain resolution mirrors effective_chain_models (tenant override → platform inherit);
-- pricing comes from catalog.model_endpoints for the step's (model, router, capability).
-- Called at rollup time so the figure is snapshotted (a later price edit → A4 reconcile).
create or replace function metering.cloud_equiv(
  p_tenant uuid,
  p_chain  text,
  p_in     bigint,
  p_out    bigint
) returns table (cloud_equiv_usd numeric, is_local_only boolean, is_unpriced boolean)
language sql
stable
security definer
set search_path = metering, public, config, core, extensions
as $$
  with cloud_steps as (
    select ecm.model_id, ecm.router_id, ecm.capability_id
      from public.effective_chain_models ecm
     where ecm.tenant_id  = p_tenant
       and ecm.chain_name = p_chain
       and ecm.plane      = 'cloud'
  ),
  priced as (
    select min( coalesce(p_in, 0)  * me.cost_per_input_token
              + coalesce(p_out, 0) * me.cost_per_output_token ) as step_cost
      from cloud_steps cs
      join catalog.model_endpoints me
        on  me.model_id  = cs.model_id
        and me.router_id = cs.router_id
        and (me.capability_id = cs.capability_id or cs.capability_id is null)
        and me.is_active
        and me.cost_per_input_token  is not null
        and me.cost_per_output_token is not null
  )
  select
    coalesce((select step_cost from priced), 0)::numeric  as cloud_equiv_usd,
    not exists (select 1 from cloud_steps)                as is_local_only,
    ( exists (select 1 from cloud_steps)
      and (select step_cost from priced) is null )        as is_unpriced;
$$;

revoke execute on function metering.cloud_equiv(uuid, text, bigint, bigint) from public;
grant  execute on function metering.cloud_equiv(uuid, text, bigint, bigint) to service_role;

comment on function metering.cloud_equiv is
'O2 §8: cloud-equivalent baseline — cheapest priced cloud step in the chain, on the
call''s actual tokens. Returns (cloud_equiv_usd, is_local_only, is_unpriced).
Conservative floor; unpriced/local-only surfaced, never guessed. service_role only.';
