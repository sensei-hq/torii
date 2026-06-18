-- database/ddl/table/public/document_embeddings.ddl
set search_path to public, extensions;

create extension if not exists vector;

create table if not exists document_embeddings (
  tenant_id      uuid    not null
, id             uuid    not null default gen_random_uuid()
, document_id    uuid    not null
, chunk_sequence integer not null
, content        text    not null
, embedding      vector(384) not null
, token_count    integer
, start_position integer
, end_position   integer
, metadata       jsonb
, modified_at    timestamptz default now()
, primary key (tenant_id, id)
, unique (tenant_id, document_id, chunk_sequence)
, foreign key (tenant_id, document_id)
    references documents(tenant_id, id) on delete cascade
) partition by list (tenant_id);

create index if not exists idx_embeddings_hnsw
  on document_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

comment on table document_embeddings is
'Chunked text embeddings for vector similarity search.
- tenant_id: new column, partition key
- 384-dimensional vectors (matches all-MiniLM-L6-v2 / text-embedding-3-small)
- HNSW index for fast approximate nearest neighbor search
- Composite FK to documents(tenant_id, id) — cascades on delete';
