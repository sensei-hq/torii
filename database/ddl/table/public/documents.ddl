-- database/ddl/table/public/documents.ddl
set search_path to public, extensions;

create table if not exists documents (
  tenant_id          uuid
, id                 uuid        not null default gen_random_uuid()
, title              varchar(255)
, original_filename  varchar(500) not null
, storage_path       varchar(1000)
, file_size          integer
, content_type       varchar(100) not null
, scope              varchar(20)  not null default 'user'
    check (scope in ('system', 'tenant', 'user'))
, profile_id         uuid
, status             varchar(20)  not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'completed', 'failed'))
, chunk_count        integer
, embedding_model    varchar(100)
, error_message      text
, uploaded_at        timestamptz  not null default now()
, started_at         timestamptz
, completed_at       timestamptz
, modified_at        timestamptz  default now()
, primary key (tenant_id, id)
);

create index if not exists idx_documents_scope
  on documents(scope, tenant_id, profile_id);

create index if not exists idx_documents_status
  on documents(status);

comment on table documents is
'Document metadata for the vector pipeline.
- tenant_id: partition key (renamed from organization_id)
- scope: system (global), tenant (shared within tenant), user (private)
  NOTE: scope value ''organization'' renamed to ''tenant'' — data migration required
  for any existing rows before altering the check constraint on a live database
- Partitioned by tenant_id — one partition per tenant created automatically';
