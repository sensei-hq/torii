-- database/ddl/view/core/apikeys_for_tenant.ddl
set search_path to core, extensions;

-- §D §B shield view: the stable read contract for GET /v1/apikeys, decoupling it from the
-- public→core move. NEVER projects hashed_secret (secret stays service_role-only). Gateway-internal
-- read model — read via the pool, tenant-filtered + capability-gated in ledger.rs. status is the
-- core.api_key_status enum, exposed as text for a stable label contract.
create or replace view apikeys_for_tenant as
select
  tenant_id
, id
, prefix
, profile_id
, service_account_id
, scope
, status::text as status
, last_used_at
, created_at
from core.api_keys;

comment on view apikeys_for_tenant is
'API-key read shield (§D §B): core.api_keys minus the secret. Backs /v1/apikeys; the gateway
filters tenant_id + gates on the apikey capability. Isolates the keys screen from the schema move.';
