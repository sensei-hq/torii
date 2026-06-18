-- database/ddl/table/staging/tenant_keys.ddl
set search_path to staging;

create table if not exists tenant_keys (
  tenant_id     uuid
, encrypted_dek text        -- hex-encoded ciphertext: [12-byte IV][16-byte auth tag][32-byte ciphertext]
, dek_version   integer
, modified_at   timestamptz
, modified_by   varchar
);

create unique index if not exists tenant_keys_ukey on tenant_keys(tenant_id);
