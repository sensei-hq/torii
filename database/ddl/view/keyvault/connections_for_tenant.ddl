-- database/ddl/view/keyvault/connections_for_tenant.ddl
set search_path to keyvault, catalog, core, extensions;

-- §D §B ★ TOP SHIELD view: the stable read contract for GET /v1/connections, shipped BEFORE the
-- Phase 2 secret-custody move so the Connections screen never observes router_credentials sliding
-- into the deny-all keyvault schema. Projects ONLY booleans + timestamps (connected/oauth flags via
-- EXISTS on an active credential, and its modified_at) — ciphertext (encrypted_api_key/oauth) is
-- structurally absent. Gateway-internal read model: read via the service_role pool, tenant-filtered
-- + capability-gated (connection.manage) in ledger.rs. NEVER grant to authenticated — this view
-- carries every tenant's rows and has no security_invoker, so a grant would be a PostgREST
-- cross-tenant leak (matches apikeys_for_tenant / effective_chain_models).
--
-- Shape: one row per (tenant, router). catalog.routers is the platform-global catalog (no tenant_id),
-- so routers the caller has NOT connected must still appear as connected=false — hence the
-- core.tenants × catalog.routers product (cross-join precedent: effective_chain_models), with the
-- per-tenant credential joined INSIDE the left join. The two credential joins read
-- keyvault.router_credentials (same-schema after the Phase 2 move; deny-all, service_role-only).
create or replace view connections_for_tenant as
select
  t.id                            as tenant_id
, r.name
, r.api_base_url
, r.is_active
, (r.api_key_env_var is not null) as requires_key
, (k.id is not null)             as connected
, k.modified_at                  as connected_at
, (o.id is not null)             as oauth_connected
, o.modified_at                  as oauth_connected_at
from core.tenants t
cross join catalog.routers r
left join keyvault.router_credentials k
  on  k.router_id       = r.id
  and k.tenant_id       = t.id
  and k.is_active       = true
  and k.credential_type = 'api_key'
left join keyvault.router_credentials o
  on  o.router_id       = r.id
  and o.tenant_id       = t.id
  and o.is_active       = true
  and o.credential_type = 'oauth';

comment on view connections_for_tenant is
'Connections read shield (§D §B, ★ top shield): core.tenants × catalog.routers × router_credentials,
projecting ONLY connection booleans + timestamps — never ciphertext. Backs GET /v1/connections; the
gateway filters tenant_id + gates on connection.manage. Isolates the Connections screen from the
Phase 2 router_credentials public→keyvault deny-all move (Slice B repoints the credential joins).';
