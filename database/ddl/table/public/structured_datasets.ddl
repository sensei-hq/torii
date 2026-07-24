-- database/ddl/table/public/structured_datasets.ddl
set search_path to public, core, extensions;
-- RW15 (§3c): a queryable structured dataset (CSV/XLSX or extracted table).
create table if not exists structured_datasets (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, id           uuid        not null default gen_random_uuid()
, space_id     uuid
, document_id  uuid
, name         varchar(200) not null
, storage_ref  text
, row_count    integer
, created_at   timestamptz not null default now()
, primary key (tenant_id, id)
);
comment on table structured_datasets is 'RW15 (§3c): queryable dataset; sensitive columns field-encrypted (dataset_columns). Compute in the trusted boundary. Service_role-write.';
