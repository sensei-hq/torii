set search_path to public, extensions;

-- C5 hybrid retrieval: dense (pgvector cosine, HNSW) + BM25 (Postgres FTS, ts_rank_cd over the
-- generated tsv) legs, each ranked, FULL OUTER JOINed and fused by Reciprocal Rank Fusion
-- (1/(k+rank), k=60 default). The 4-level-classification + space-membership + hard-tenant predicate
-- MIRRORS policies/knowledge.sql documents_read EXACTLY: the gateway calls this as service_role
-- (RLS-bypassing), so isolation MUST live in-query. Cross-tenant recall = 0. Excludes superseded
-- chunks and filters d.status='completed' (same terminal value as similarity_search). All k_* + rrf_k
-- + match_threshold are parameters (no-hardcoded-ops). language sql (no plpgsql / do-$$).
create or replace function hybrid_search(
  query_embedding vector(1024),
  query_text      text,
  p_tenant_id     uuid,
  p_profile_id    uuid,
  p_space_id      uuid     default null,
  doc_ids         uuid[]   default null,
  k_dense         int      default 100,
  k_bm25          int      default 100,
  k_out           int      default 20,
  rrf_k           int      default 60,
  match_threshold float    default 0.0
)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  content      text,
  section_path text,
  page_ref     int,
  element_type varchar,
  dense_sim    float,
  dense_rank   int,
  bm25_score   float,
  bm25_rank    int,
  rrf_score    float
)
language sql stable as $$
  with visible as (
    select de.id, de.document_id, de.content, de.section_path, de.page_ref, de.element_type,
           de.embedding, de.tsv
    from document_embeddings de
    join documents d
      on d.tenant_id = de.tenant_id
     and d.id        = de.document_id
    where de.tenant_id = p_tenant_id
      and de.superseded_at is null
      and d.lifecycle = 'completed'
      and (p_space_id is null or d.space_id = p_space_id)
      and (doc_ids is null or d.id = any(doc_ids))
      and (
        d.classification in ('public', 'internal')
        or d.profile_id = p_profile_id
        or (d.classification = 'confidential' and d.space_id is not null and exists (
              select 1 from space_members sm
              where sm.tenant_id = d.tenant_id
                and sm.space_id  = d.space_id
                and sm.profile_id = p_profile_id))
        or (d.classification = 'restricted' and d.space_id is not null and exists (
              select 1 from spaces s
              where s.tenant_id = d.tenant_id
                and s.id        = d.space_id
                and s.owner_id  = p_profile_id))
      )
  ),
  dense as (
    select id,
           1 - (embedding <=> query_embedding) as sim,
           row_number() over (order by embedding <=> query_embedding) as rnk
    from visible
    where 1 - (embedding <=> query_embedding) > match_threshold
    order by embedding <=> query_embedding
    limit k_dense
  ),
  bm25 as (
    select v.id,
           ts_rank_cd(v.tsv, q) as score,
           row_number() over (order by ts_rank_cd(v.tsv, q) desc) as rnk
    from visible v, websearch_to_tsquery('english', query_text) q
    where v.tsv @@ q
    order by ts_rank_cd(v.tsv, q) desc
    limit k_bm25
  ),
  fused as (
    select coalesce(dd.id, bb.id) as id,
           dd.sim  as dense_sim,
           dd.rnk  as dense_rank,
           bb.score as bm25_score,
           bb.rnk   as bm25_rank,
           coalesce(1.0 / (rrf_k + dd.rnk), 0) + coalesce(1.0 / (rrf_k + bb.rnk), 0) as rrf
    from dense dd
    full outer join bm25 bb on dd.id = bb.id
  )
  select v.id, v.document_id, v.content, v.section_path, v.page_ref, v.element_type,
         f.dense_sim, f.dense_rank::int, f.bm25_score, f.bm25_rank::int, f.rrf
  from fused f
  join visible v on v.id = f.id
  order by f.rrf desc
  limit k_out;
$$;

comment on function hybrid_search is
'C5 hybrid retrieval: dense pgvector cosine + BM25 FTS fused by RRF (k=60 default). The 4-level
classification + space-membership predicate mirrors policies/knowledge.sql documents_read EXACTLY, so
the service_role gateway path enforces the same isolation RLS gives authenticated callers
(cross-tenant recall = 0) — and adds the classification predicate similarity_search omits. Excludes
superseded chunks; filters status=''completed''. k_* + rrf_k + match_threshold are parameters
(no-hardcoded-ops). websearch_to_tsquery makes user query_text injection-safe.';

grant execute on function hybrid_search(vector, text, uuid, uuid, uuid, uuid[], int, int, int, int, float)
  to authenticated;
grant execute on function hybrid_search(vector, text, uuid, uuid, uuid, uuid[], int, int, int, int, float)
  to service_role;
