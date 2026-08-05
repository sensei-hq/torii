-- database/ddl/table/keyvault/tenant_key_archive.ddl
set search_path to keyvault, core, extensions;

create table if not exists tenant_key_archive (
  tenant_id     uuid        not null
    references core.tenants(id) on delete cascade
, dek_version   integer     not null
, encrypted_dek bytea       not null
    -- A superseded DEK, still sealed under the master KEK. Layout as keyvault.tenant_keys.
, archived_at   timestamptz not null default now()
, modified_by   varchar     not null
, primary key (tenant_id, dek_version)
);

comment on table tenant_key_archive is
'Superseded per-tenant DEKs, retained after keyvault.tenant_keys rotation (V4).
- Populated by the vault''s rotate_dek: the prior DEK is copied here before the new one
  replaces it in keyvault.tenant_keys.
- rotate_dek re-seals every active keyvault.router_credentials row under the new DEK in the SAME
  transaction, so live resolution never reads this table. It exists for recovery (decrypting
  a pre-rotation backup / a still-inactive row) and must be re-wrapped alongside
  keyvault.tenant_keys on KEK rotation (rotate_kek).
- Same protection as tenant_keys: RLS deny-all + service_role-only (see policies/secrets.sql).';
