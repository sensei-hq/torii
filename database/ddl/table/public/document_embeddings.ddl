-- database/ddl/table/public/document_embeddings.ddl
set search_path to public, extensions;

create extension if not exists vector;

create table if not exists document_embeddings (
  tenant_id      uuid    not null
, id             uuid    not null default gen_random_uuid()
, document_id    uuid    not null
, chunk_sequence integer not null
, content        text    not null
, embedding      vector(1024) not null
, token_count    integer
, start_position integer
, end_position   integer
, metadata       jsonb
, modified_at    timestamptz default now()
, primary key (tenant_id, id)
, unique (tenant_id, document_id, chunk_sequence)
, foreign key (tenant_id, document_id)
    references documents(tenant_id, id) on delete cascade
);

create index if not exists idx_embeddings_hnsw
  on document_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

comment on table document_embeddings is
'Chunked text embeddings for vector similarity search.
- tenant_id: new column, partition key
- 1024-dimensional vectors (central ingestion embedding model; see C5)
- HNSW index for fast approximate nearest neighbor search
- Composite FK to documents(tenant_id, id) — cascades on delete';

-- C5 RAG (2026-08-01): chunk provenance + the BM25 lexical leg + version-scoped uniqueness.
alter table document_embeddings add column if not exists version_id        uuid;
alter table document_embeddings add column if not exists parent_chunk_id   uuid;   -- small-to-big overlay (unused v1)
alter table document_embeddings add column if not exists contextual_prefix text;   -- contextual-enrichment seam (null v1; folded into tsv)
alter table document_embeddings add column if not exists section_path      text;
alter table document_embeddings add column if not exists page_ref          integer;
alter table document_embeddings add column if not exists element_type      varchar(16) not null default 'prose';
alter table document_embeddings add column if not exists redaction_count   integer not null default 0;
alter table document_embeddings add column if not exists superseded_at     timestamptz;
-- BM25 leg: a STORED generated tsv derived from the SAME row's content(+prefix). Dense vector and
-- sparse index are therefore ONE logical unit that CANNOT drift (satisfies the dual-write invariant
-- structurally, zero write-code). 'english' regconfig is an immutable literal (required for GENERATED);
-- multilingual is a documented v1 fallback (tenant_languages drives a later language-parameterized tsv).
alter table document_embeddings add column if not exists tsv tsvector
  generated always as (to_tsvector('english', coalesce(contextual_prefix,'') || ' ' || content)) stored;
-- Version-scoped uniqueness: a prior version's chunks (marked superseded_at) coexist with the new
-- version's identical chunk_sequence values during atomic retirement on re-ingest.
alter table document_embeddings drop constraint if exists document_embeddings_tenant_id_document_id_chunk_sequence_key;
-- drop the new name too so re-applying is idempotent (add constraint has no `if not exists`).
alter table document_embeddings drop constraint if exists document_embeddings_tenant_doc_version_seq_key;
alter table document_embeddings add constraint document_embeddings_tenant_doc_version_seq_key
  unique (tenant_id, document_id, version_id, chunk_sequence);
create index if not exists idx_embeddings_tsv on document_embeddings using gin (tsv);
create index if not exists idx_embeddings_superseded on document_embeddings(tenant_id, document_id, superseded_at);
