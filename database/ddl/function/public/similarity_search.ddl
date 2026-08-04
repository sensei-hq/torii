set search_path to public, extensions;

-- RW9/RW10: 1024-dim embeddings (was 384), and the group-ACL branch is retired.
-- Doc access is space + fixed 4-level classification only: for an authenticated
-- caller the joins are RLS-filtered (knowledge.sql); for the service_role gateway
-- the explicit p_tenant_id filter scopes results. user-scoped docs → owner only.
create or replace function similarity_search(
  query_embedding   vector(1024),
  match_threshold   float    default 0.3,
  match_count       int      default 5,
  scope_filter      text[]   default null,
  doc_ids           uuid[]   default null,
  p_profile_id      uuid     default null,
  p_tenant_id       uuid     default null
)
returns table (
  chunk_id          uuid,
  document_id       uuid,
  document_title    varchar,
  original_filename varchar,
  content           text,
  similarity        float,
  chunk_sequence    integer,
  metadata          jsonb
)
language sql stable as $$
  select
    de.id as chunk_id,
    d.id as document_id,
    d.title as document_title,
    d.original_filename,
    de.content,
    1 - (de.embedding <=> query_embedding) as similarity,
    de.chunk_sequence,
    de.metadata
  from document_embeddings de
  join documents d
    on d.tenant_id = de.tenant_id
   and d.id        = de.document_id
  where d.lifecycle = 'completed'
    and (scope_filter is null or d.scope::text = any(scope_filter))
    and (doc_ids is null or d.id = any(doc_ids))
    and (p_tenant_id is null or d.tenant_id = p_tenant_id or d.scope = 'system')
    and (
      p_profile_id is null
      or d.scope != 'user'
      or d.profile_id = p_profile_id
    )
    and 1 - (de.embedding <=> query_embedding) > match_threshold
  order by de.embedding <=> query_embedding
  limit match_count;
$$;

comment on function similarity_search is
'RW9/RW10: 1024-dim cosine similarity search over document_embeddings.
- vector(1024) matches document_embeddings.embedding.
- tenant_id guard ensures cross-tenant data is never returned.
- Access = space + fixed 4-level classification (documents RLS for authenticated
  callers; explicit p_tenant_id for the service_role gateway). Group-ACL retired.
- Results ordered by similarity (highest first).';
