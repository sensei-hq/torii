-- database/ddl/table/public/documents.ddl
set search_path to public, core, content, extensions;

create table if not exists documents (
  tenant_id          uuid
, id                 uuid        not null default gen_random_uuid()
, title              varchar(255)
, original_filename  varchar(500) not null
, storage_path       varchar(1000)
, file_size          integer
, content_type       varchar(100) not null
, scope              content.document_scope not null default 'user'
, profile_id         uuid
, space_id           uuid
, collection_id      uuid
, classification     core.classification_level not null default 'internal'
  -- §7-#5 SPLIT: stable lifecycle enum + a free-form transient stage. lifecycle drives
  -- retrieval (hybrid_search/similarity_search filter lifecycle='completed') + the W1/W2 screens;
  -- stage carries the fine pipeline step (parsing/redacting/chunking/embedding/indexing), so a
  -- pipeline change never churns the enum. set_status() maps a step onto (lifecycle, stage).
, lifecycle          content.document_lifecycle not null default 'pending'
, stage              varchar(20)
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
  on documents(lifecycle);

create index if not exists idx_documents_content_hash on documents(tenant_id, content_hash);

comment on table documents is
'Document metadata for the vector pipeline.
- tenant_id: partition key (renamed from organization_id)
- scope: system (global), tenant (shared within tenant), user (private)
- space_id: optional FK to spaces; classification governs confidentiality
- Access (incl. confidential/restricted) is enforced via RLS in policies/knowledge.sql';
