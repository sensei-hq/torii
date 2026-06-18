-- database/ddl/table/staging/router_keys.ddl
set search_path to staging;

create table if not exists router_keys (
  tenant_id         uuid        not null
, router_name       varchar(100) not null   -- resolved to config.routers.id on import
, encrypted_api_key text        not null   -- hex-encoded ciphertext: [12-byte IV][16-byte auth tag][variable ciphertext]
, key_label         varchar
, is_active         boolean     default true
, modified_at       timestamptz
, modified_by       varchar
);

create unique index if not exists router_keys_ukey on router_keys(tenant_id, router_name);
