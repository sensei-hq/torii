-- database/ddl/table/public/dataset_columns.ddl
set search_path to public, core, extensions;
-- RW15 (§3c): per-column schema + sensitivity + field-encryption flag.
create table if not exists dataset_columns (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, id           uuid        not null default gen_random_uuid()
, dataset_id   uuid        not null
, name         varchar(200) not null
, data_type    varchar(40) not null default 'text'
, sensitivity  core.classification_level not null default 'public'
, encrypted    boolean     not null default false
, stats        jsonb       not null default '{}'
, primary key (tenant_id, id)
, foreign key (tenant_id, dataset_id) references structured_datasets(tenant_id, id) on delete cascade
);
comment on table dataset_columns is 'RW15 (§3c): column schema + sensitivity; encrypted columns decrypt only in the central boundary (v1). Service_role-write.';
