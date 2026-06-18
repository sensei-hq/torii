-- database/ddl/table/staging/tenants.ddl
set search_path to staging;

create table if not exists tenants (
  id           uuid
, name         varchar
, slug         varchar
, domain       varchar
, is_platform  boolean
, status       varchar
, created_at   timestamptz
, modified_at  timestamptz
, modified_by  varchar
);

create unique index if not exists tenants_ukey on tenants(slug);
