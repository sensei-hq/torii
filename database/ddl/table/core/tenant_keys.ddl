-- database/ddl/table/core/tenant_keys.ddl
set search_path to core, extensions;

create table if not exists tenant_keys (
  tenant_id    uuid        primary key
    references core.tenants(id) on delete cascade
, encrypted_dek bytea      not null
    -- Layout: [12-byte IV][16-byte auth tag][32-byte ciphertext] = 60 bytes total
    -- Encrypted with STRATEGOS_KEK (AES-256-GCM) by application layer
, dek_version  integer     not null default 1
    -- Incremented by application layer on DEK rotation
, created_at   timestamptz not null default now()
, modified_at  timestamptz not null default now()
, modified_by  varchar     not null
);

comment on table tenant_keys is
'Per-tenant Data Encryption Key (DEK) used to encrypt router API keys.
- encrypted_dek: DEK encrypted with master KEK from STRATEGOS_KEK env var
- dek_version: incremented by application on DEK rotation
- DEK rotation requires re-encrypting all router_keys rows for this tenant atomically
- KEK rotation only requires re-encrypting encrypted_dek rows (not router_keys)';
