-- database/ddl/table/public/router_credentials.ddl
set search_path to public, core, config, extensions;

create table if not exists router_credentials (
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
);

-- V4: relaxed for rotation overlap. At most one ACTIVE credential per (tenant, router),
-- but superseded (is_active = false) rows are retained rather than overwritten — so a
-- rotation can keep the prior key as history/rollback. The old full unique index is dropped
-- (defensive, for apply-over-existing; a fresh `dbd reset` never has it).
drop index if exists router_credentials_tenant_router_ukey;
create unique index if not exists router_credentials_active_ukey
  on router_credentials(tenant_id, router_id) where is_active;

create index if not exists router_credentials_active_idx
  on router_credentials(tenant_id, router_id, is_active);

comment on table router_credentials is
'Encrypted router API keys per tenant.
- One ACTIVE key per (tenant, router) (partial unique on is_active); superseded rows retained (V4)
- id retained for API-layer row addressing; (tenant_id, router_id) is the effective unique key
- encrypted_api_key: API key encrypted with tenant DEK from core.tenant_keys
- viable_chain_models view uses this table to filter usable (router, model) combinations
- Decryption happens in application layer only — never exposed via views';

-- RW13 (DECISIONS §3): the vault holds api_key + OAuth credentials. Renamed from
-- `router_keys` → `router_credentials` (#18); the viable_chain_models view + secrets.sql
-- track the new name. OAuth tokens are encrypted like keys, service_role-only,
-- auto-refreshed by F3 before expiry.
alter table router_credentials add column if not exists credential_type varchar(10) not null default 'api_key'
    check (credential_type in ('api_key', 'oauth'));
alter table router_credentials add column if not exists encrypted_oauth   bytea;   -- [IV][tag][access+refresh JSON ct]
alter table router_credentials add column if not exists oauth_expires_at  timestamptz;
alter table router_credentials add column if not exists oauth_scopes      text;
alter table router_credentials add column if not exists token_url         text;
alter table router_credentials add column if not exists refresh_status    varchar(16);
alter table router_credentials add column if not exists last_refreshed_at timestamptz;
