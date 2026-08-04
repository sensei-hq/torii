-- database/ddl/table/public/document_versions.ddl
set search_path to public, extensions;

create table if not exists document_versions (
  tenant_id    uuid not null
, id           uuid not null default gen_random_uuid()
, document_id  uuid not null
, version_no   integer not null
, storage_path varchar(1000)
, file_size    integer
, content_type varchar(100)
, note         text
, created_at   timestamptz not null default now()
, created_by   varchar
  -- C5 RAG: content-hash dedup/idempotency, parser provenance, and the stale-chunk
  -- retirement marker (superseded_at pairs with document_embeddings.superseded_at on re-ingest).
, content_hash   char(64)
, parser         varchar(60)
, parser_version varchar(40)
, superseded_at  timestamptz
, primary key (tenant_id, id)
, unique (tenant_id, document_id, version_no)
, foreign key (tenant_id, document_id)
    references documents(tenant_id, id) on delete cascade
);

create index if not exists idx_document_versions_doc on document_versions(tenant_id, document_id);
create index if not exists idx_document_versions_hash on document_versions(tenant_id, content_hash);

comment on table document_versions is
'Version history of a document''s source file. Access inherits the parent document
(policies/knowledge.sql); composite FK keeps versions in-tenant.';
