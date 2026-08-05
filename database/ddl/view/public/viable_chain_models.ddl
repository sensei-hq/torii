-- database/ddl/view/public/viable_chain_models.ddl
set search_path to public, keyvault, extensions;

create or replace view public.viable_chain_models as
select ecm.*
from public.effective_chain_models ecm
join keyvault.router_credentials rk
  on  rk.tenant_id = ecm.tenant_id
  and rk.router_id = ecm.router_id
  and rk.is_active  = true
where ecm.is_active = true;

comment on view public.viable_chain_models is
'Filters effective_chain_models to only rows where the tenant has an active router key.
- The gateway uses this view to build the actual fallback sequence for a request
- encrypted_api_key is NOT exposed — callers fetch it separately from keyvault.router_credentials
- Filter by tenant_id + chain_name + order by sequence_order to get the usable sequence';
