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
, space_id           uuid
, collection_id      uuid
, classification     varchar(20)  not null default 'internal'
    check (classification in ('public', 'internal', 'confidential', 'restricted'))
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
, foreign key (tenant_id, space_id)
    references spaces(tenant_id, id) on delete set null
, foreign key (tenant_id, collection_id)
    references document_collections(tenant_id, id) on delete set null
);

create index if not exists idx_documents_scope
  on documents(scope, tenant_id, profile_id);

create index if not exists idx_documents_status
  on documents(status);

comment on table documents is
'Document metadata for the vector pipeline.
- tenant_id: partition key (renamed from organization_id)
- scope: system (global), tenant (shared within tenant), user (private)
- space_id: optional FK to spaces; classification governs confidentiality
- Access (incl. confidential/restricted) is enforced via RLS in policies/knowledge.sql';

-- C5 RAG (2026-08-01): additive ingestion-pipeline + dedup/versioning columns. Trailing
-- add-column-if-not-exists is the repo house style for post-ship additive changes (cf.
-- budget_nodes.ddl) so `dbd apply` is idempotent + NON-destructive on the live data-bearing DB.
alter table documents add column if not exists content_hash       char(64);
-- current_version_id: plain uuid, NO FK — a documents<->document_versions FK would be a cyclic
-- forward-ref (dbd rule); integrity is enforced in the ingest transaction.
alter table documents add column if not exists current_version_id uuid;
alter table documents add column if not exists status_reason       text;
-- Broaden the status CHECK with the fine pipeline stages; KEEP 'completed' as the terminal value
-- (similarity_search + hybrid_search + the W1/W2 admin screens all filter on 'completed').
alter table documents drop constraint if exists documents_status_check;
alter table documents add constraint documents_status_check check (status in (
  'uploaded','queued','parsing','redacting','chunking','embedding','indexing','processing','completed','failed'));
create index if not exists idx_documents_content_hash on documents(tenant_id, content_hash);
