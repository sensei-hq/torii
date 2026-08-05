-- database/ddl/table/keyvault/router_credentials.ddl
set search_path to keyvault, core, catalog, extensions;

-- Encrypted per-tenant provider credentials — api_key AND OAuth (RW13 / #18: renamed from
-- `router_keys`; the chains_for_tenant view + secrets.sql track this name). All columns are
-- declared inline (declarative schema — dbd applies the whole table in one shot; no forward
-- references from indexes/constraints to columns added later).
create table if not exists router_credentials (
  tenant_id         uuid        not null
    references core.tenants(id) on delete cascade
, id                uuid        not null default gen_random_uuid()
, router_id         uuid        not null references catalog.routers(id)
, encrypted_api_key bytea
    -- [12B IV][16B tag][ct], encrypted with the tenant DEK (keyvault.tenant_keys). NULL for an
    -- oauth row (which carries encrypted_oauth instead) — enforced by the blob-by-type CHECK.
, key_label         varchar
, is_active         boolean     not null default true
, created_at        timestamptz not null default now()
, modified_at       timestamptz not null default now()
, modified_by       varchar     not null
-- Credential kind + OAuth columns (RW13). OAuth tokens are encrypted like keys, service_role-only.
, credential_type   keyvault.credential_type not null default 'api_key'
, encrypted_oauth   bytea                              -- [IV][tag][access+refresh JSON ct]
, oauth_expires_at  timestamptz
, oauth_scopes      text
, oauth_client_id   text                               -- O-7: PKCE client_id (paste-token: NULL)
, token_url         text
, refresh_status    keyvault.refresh_status
, last_refreshed_at timestamptz
, primary key (tenant_id, id)
-- O-7: an api_key row carries encrypted_api_key; an oauth row carries encrypted_oauth.
, constraint router_credentials_blob_by_type
    check ((credential_type = 'api_key'::keyvault.credential_type and encrypted_api_key is not null)
        or (credential_type = 'oauth'::keyvault.credential_type   and encrypted_oauth   is not null))
);

-- V4 + O-7: at most one ACTIVE credential per (tenant, router, credential_type) — so ONE api_key
-- AND ONE oauth can be active for the same (tenant, router); superseded (is_active=false) rows are
-- retained (rotation history/rollback) rather than overwritten.
create unique index if not exists router_credentials_active_ukey
  on router_credentials(tenant_id, router_id, credential_type) where is_active;

create index if not exists router_credentials_active_idx
  on router_credentials(tenant_id, router_id, is_active);

comment on table router_credentials is
'Encrypted router credentials per tenant (api_key + OAuth).
- One ACTIVE credential per (tenant, router, credential_type); superseded rows retained (V4/O-7)
- id retained for API-layer row addressing; (tenant_id, router_id, credential_type) is the active key
- encrypted_api_key / encrypted_oauth: sealed with the tenant DEK from keyvault.tenant_keys
- catalog.chains_for_tenant uses this table (keyless-safe) to filter usable (router, model) steps
- Decryption happens in application layer only — never exposed via views';
