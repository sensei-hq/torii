set search_path to public, extensions;

create or replace function similarity_search(
  query_embedding   vector(384),
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
  where d.status = 'completed'
    and (scope_filter is null or d.scope = any(scope_filter))
    and (doc_ids is null or d.id = any(doc_ids))
    and (p_tenant_id is null or d.tenant_id = p_tenant_id or d.scope = 'system')
    and (
      p_profile_id is null
      or d.profile_id = p_profile_id
      or d.scope != 'user'
      or exists (
        select 1 from user_accessible_documents uad
        where uad.document_id = d.id
          and uad.profile_id  = p_profile_id
          and uad.tenant_id   = p_tenant_id
      )
    )
    and 1 - (de.embedding <=> query_embedding) > match_threshold
  order by de.embedding <=> query_embedding
  limit match_count;
$$;

comment on function similarity_search is
'Scope-filtered cosine similarity search over document embeddings.
- p_organization_id renamed to p_tenant_id
- tenant_id guard ensures cross-tenant data is never returned
- Group-based access: when p_profile_id is provided, also returns documents
  accessible to the user via user_accessible_documents (group inheritance)
- Returns results ordered by similarity (highest first)';
