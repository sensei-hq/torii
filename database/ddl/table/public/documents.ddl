-- database/ddl/table/public/documents.ddl
set search_path to public, core, extensions;

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
, classification     core.classification_level not null default 'internal'
, status             varchar(20)  not null default 'uploaded'
    -- fine pipeline stages; 'completed' stays the terminal value (similarity_search +
    -- hybrid_search + the W1/W2 admin screens filter on it). Redesign later splits this into
    -- a stable lifecycle enum + a free-form stage column (db-redesign §7-#5).
    check (status in ('uploaded','queued','parsing','redacting','chunking','embedding','indexing','processing','completed','failed'))
, chunk_count        integer
, embedding_model    varchar(100)
, error_message      text
, uploaded_at        timestamptz  not null default now()
, started_at         timestamptz
, completed_at       timestamptz
, modified_at        timestamptz  default now()
  -- C5 RAG: dedup + versioning. current_version_id is a plain uuid, NO FK — a
  -- documents<->document_versions FK would be a cyclic forward-ref (dbd rule); integrity is
  -- enforced in the ingest transaction.
, content_hash       char(64)
, current_version_id uuid
, status_reason      text
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

create index if not exists idx_documents_content_hash on documents(tenant_id, content_hash);

comment on table documents is
'Document metadata for the vector pipeline.
- tenant_id: partition key (renamed from organization_id)
- scope: system (global), tenant (shared within tenant), user (private)
- space_id: optional FK to spaces; classification governs confidentiality
- Access (incl. confidential/restricted) is enforced via RLS in policies/knowledge.sql';
