-- database/ddl/table/public/router_keys.ddl
set search_path to public, core, config, extensions;

create table if not exists router_keys (
  tenant_id         uuid        not null
    references core.tenants(id) on delete cascade
, id                uuid        not null default gen_random_uuid()
, router_id         uuid        not null references config.routers(id)
, encrypted_api_key bytea       not null
    -- Layout: [12-byte IV][16-byte auth tag][variable ciphertext]
    -- Encrypted with the tenant's DEK (see core.tenant_keys)
, key_label         varchar
, is_active         boolean     not null default true
, created_at        timestamptz not null default now()
, modified_at       timestamptz not null default now()
, modified_by       varchar     not null
, primary key (tenant_id, id)
) partition by list (tenant_id);

create unique index if not exists router_keys_tenant_router_ukey
  on router_keys(tenant_id, router_id);

create index if not exists router_keys_active_idx
  on router_keys(tenant_id, router_id, is_active);

comment on table router_keys is
'Encrypted router API keys per tenant.
- One key per (tenant, router) — zero-downtime rotation not supported (replace the row)
- id retained for API-layer row addressing; (tenant_id, router_id) is the effective unique key
- encrypted_api_key: API key encrypted with tenant DEK from core.tenant_keys
- viable_chain_models view uses this table to filter usable (router, model) combinations
- Decryption happens in application layer only — never exposed via views';
