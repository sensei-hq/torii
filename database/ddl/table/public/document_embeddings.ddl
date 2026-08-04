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
  -- C5 RAG: chunk provenance + the BM25 lexical leg + version-scoped uniqueness.
, version_id        uuid
, parent_chunk_id   uuid                             -- small-to-big overlay (unused v1)
, contextual_prefix text                             -- contextual-enrichment seam (null v1; folded into tsv)
, section_path      text
, page_ref          integer
, element_type      varchar(16) not null default 'prose'
, redaction_count   integer     not null default 0
, superseded_at     timestamptz
  -- BM25 leg: a STORED generated tsv derived from the SAME row's content(+prefix). Dense vector and
  -- sparse index are ONE logical unit that CANNOT drift (satisfies the dual-write invariant
  -- structurally). 'english' is an immutable literal (required for GENERATED); multilingual is a
  -- documented v1 fallback (tenant_languages drives a later language-parameterized tsv).
, tsv tsvector generated always as
    (to_tsvector('english', coalesce(contextual_prefix,'') || ' ' || content)) stored
, primary key (tenant_id, id)
  -- Version-scoped uniqueness: a prior version's chunks (marked superseded_at) coexist with the
  -- new version's identical chunk_sequence values during atomic retirement on re-ingest.
, unique (tenant_id, document_id, version_id, chunk_sequence)
, foreign key (tenant_id, document_id)
    references documents(tenant_id, id) on delete cascade
);

create index if not exists idx_embeddings_hnsw
  on document_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_embeddings_tsv on document_embeddings using gin (tsv);
create index if not exists idx_embeddings_superseded on document_embeddings(tenant_id, document_id, superseded_at);

comment on table document_embeddings is
'Chunked text embeddings for vector similarity search.
- tenant_id: partition key; 1024-dim vectors (central ingestion embedding model; see C5).
- HNSW index for ANN; tsv (STORED generated) + GIN for the BM25 leg — dense+sparse never drift.
- Composite FK to documents(tenant_id, id) — cascades on delete. Holds ONLY redacted text (DLP).';
