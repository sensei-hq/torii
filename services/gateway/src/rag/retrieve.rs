//! C5 · hybrid retrieval — embed the query, call the `hybrid_search` SQL (dense pgvector + BM25 FTS
//! fused by RRF, under the in-query tenant/classification/space guard), assemble per-chunk
//! dense/bm25/fused scores + per-stage stats for the W3 inspector, and emit a retrieval signal.
//!
//! Rerank is a DEFERRED stage ([`RerankProvider`] → Unsupported): v1 returns the top-`k_out` fused
//! chunks with `dropped=false` (nothing is dropped by a rerank stage that doesn't exist yet).

use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use pgvector::Vector;
use sqlx::PgPool;
use uuid::Uuid;

use super::embed::Embedder;
use super::{signals, RagError, RetrievalConfig};

/// A retrieval request (the service_role path carries the caller's `profile_id` explicitly).
pub struct RetrieveQuery {
    pub text: String,
    pub profile_id: Uuid,
    pub top_k: Option<i32>,
    pub doc_ids: Option<Vec<Uuid>>,
    pub inspect: bool,
}

/// Per-leg + fused scores for one chunk (the W3 inspector contract). `rerank` is `None` in v1.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Scores {
    pub dense: Option<f64>,
    pub bm25: Option<f64>,
    pub fused: f64,
    pub rerank: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScoredChunk {
    pub chunk_id: Uuid,
    pub document_id: Uuid,
    pub text: String,
    pub section_path: Option<String>,
    pub page_ref: Option<i32>,
    pub scores: Scores,
    pub dropped: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StageStat {
    pub name: String,
    pub k_in: i32,
    pub k_out: i32,
    pub ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RetrieveResult {
    pub chunks: Vec<ScoredChunk>,
    pub stages: Vec<StageStat>,
    pub grounding_ready: bool,
    pub config_used: RetrievalConfig,
    pub redactions: i32,
}

/// Composable retrieval — assemble legs → fuse → (rerank) → context.
#[async_trait]
pub trait RetrievalEngine: Send + Sync {
    async fn retrieve(
        &self,
        tenant: Uuid,
        space: Option<Uuid>,
        q: &RetrieveQuery,
        cfg: &RetrievalConfig,
    ) -> Result<RetrieveResult, RagError>;
}

/// Cross-encoder rerank (GH-8) — DEFERRED. The seam is here so enabling it is additive (the wide
/// two-stage k is already retrieved); v1's [`NoopReranker`] returns Unsupported.
#[async_trait]
pub trait RerankProvider: Send + Sync {
    async fn rerank(
        &self,
        query: &str,
        cands: &[ScoredChunk],
        top_k: usize,
    ) -> Result<Vec<ScoredChunk>, RagError>;
}

pub struct NoopReranker;

#[async_trait]
impl RerankProvider for NoopReranker {
    async fn rerank(&self, _q: &str, _c: &[ScoredChunk], _k: usize) -> Result<Vec<ScoredChunk>, RagError> {
        Err(RagError::Unsupported("cross-encoder rerank is deferred (GH-8)"))
    }
}

/// One `hybrid_search` result row (dense/bm25 columns are nullable — a chunk may hit only one leg).
type HybridRow = (
    Uuid,          // chunk_id
    Uuid,          // document_id
    String,        // content
    Option<String>, // section_path
    Option<i32>,   // page_ref
    String,        // element_type
    Option<f64>,   // dense_sim
    Option<i32>,   // dense_rank
    Option<f64>,   // bm25_score
    Option<i32>,   // bm25_rank
    f64,           // rrf_score
);

pub struct HybridRetriever {
    pool: PgPool,
    embedder: Arc<dyn Embedder>,
}

impl HybridRetriever {
    pub fn new(pool: PgPool, embedder: Arc<dyn Embedder>) -> Self {
        Self { pool, embedder }
    }
}

#[async_trait]
impl RetrievalEngine for HybridRetriever {
    async fn retrieve(
        &self,
        tenant: Uuid,
        space: Option<Uuid>,
        q: &RetrieveQuery,
        cfg: &RetrievalConfig,
    ) -> Result<RetrieveResult, RagError> {
        let t0 = Instant::now();
        // Embed the query (validate_dims enforced inside the embedder).
        let embedded = self.embedder.embed(&[q.text.clone()]).await?;
        let qvec = embedded
            .into_iter()
            .next()
            .ok_or_else(|| RagError::Embed("query embed returned no vector".into()))?;
        let emb = Vector::from(qvec);
        let embed_ms = t0.elapsed().as_millis() as u64;

        let k_out = q.top_k.unwrap_or(cfg.k_out);
        let sql_t0 = Instant::now();
        let rows: Vec<HybridRow> = sqlx::query_as(
            "select chunk_id, document_id, content, section_path, page_ref, element_type, \
                    dense_sim, dense_rank, bm25_score, bm25_rank, rrf_score \
             from hybrid_search($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(emb)
        .bind(&q.text)
        .bind(tenant)
        .bind(q.profile_id)
        .bind(space)
        .bind(q.doc_ids.as_deref())
        .bind(cfg.k_dense)
        .bind(cfg.k_bm25)
        .bind(k_out)
        .bind(cfg.rrf_k)
        .bind(cfg.match_threshold as f64)
        .fetch_all(&self.pool)
        .await?;
        let sql_ms = sql_t0.elapsed().as_millis() as u64;

        let dense_hits = rows.iter().filter(|r| r.7.is_some()).count() as i32;
        let bm25_hits = rows.iter().filter(|r| r.9.is_some()).count() as i32;
        let fused_top = rows.first().map(|r| r.10).unwrap_or(0.0);

        let chunks: Vec<ScoredChunk> = rows
            .into_iter()
            .map(|r| ScoredChunk {
                chunk_id: r.0,
                document_id: r.1,
                text: r.2,
                section_path: r.3,
                page_ref: r.4,
                scores: Scores { dense: r.6, bm25: r.8, fused: r.10, rerank: None },
                dropped: false, // nothing dropped in v1 (rerank deferred)
            })
            .collect();

        let stages = vec![
            StageStat { name: "embed".into(), k_in: 1, k_out: 1, ms: embed_ms },
            StageStat { name: "dense".into(), k_in: cfg.k_dense, k_out: dense_hits, ms: sql_ms },
            StageStat { name: "bm25".into(), k_in: cfg.k_bm25, k_out: bm25_hits, ms: sql_ms },
            StageStat { name: "fuse".into(), k_in: dense_hits + bm25_hits, k_out: chunks.len() as i32, ms: sql_ms },
        ];

        // Best-effort quality signal (never fails the request).
        signals::record_retrieval_signal(
            &self.pool,
            tenant,
            signals::RetrievalSignal {
                space_id: space,
                actor_id: q.profile_id,
                k_in: cfg.k_dense + cfg.k_bm25,
                k_out: chunks.len() as i32,
                dense_hits,
                bm25_hits,
                fused_top,
                latency_ms: t0.elapsed().as_millis() as u64,
            },
        )
        .await;

        Ok(RetrieveResult {
            grounding_ready: !chunks.is_empty(),
            chunks,
            stages,
            config_used: cfg.clone(),
            redactions: 0, // retrieved-context redact-in-flight is C4 (deferred); ingest redacts at rest
        })
    }
}

#[cfg(test)]
mod integration {
    //! Hits local Supabase (55322). Ignored by default:
    //!   `cargo test -p torii-gateway rag::retrieve -- --ignored`
    use super::*;
    use crate::rag::chunk::Chunk;
    use crate::rag::embed::StubEmbedder;
    use crate::rag::store::{DocStore, NewDocument};
    use sqlx::postgres::PgPoolOptions;

    async fn pool() -> PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new().max_connections(2).connect(&url).await.expect("connect 55322")
    }

    fn chunk(seq: i32, text: &str) -> Chunk {
        Chunk {
            seq,
            text: text.into(),
            token_count: text.split_whitespace().count() as i32,
            section_path: Some("Intro".into()),
            page_ref: None,
            start_position: Some(0),
            end_position: Some(text.len() as i32),
            element_type: "prose",
            is_table: false,
            contextual_prefix: None,
        }
    }

    async fn embed(texts: &[&str]) -> Vec<Vec<f32>> {
        StubEmbedder
            .embed(&texts.iter().map(|s| s.to_string()).collect::<Vec<_>>())
            .await
            .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn ingest_then_retrieve_round_trips_scores() {
        let pool = pool().await;
        let store = DocStore::new(pool.clone());
        let tenant = Uuid::new_v4();
        let owner = Uuid::new_v4();
        let doc = register(&store, tenant, owner).await;
        let (vid, _n, _p) = store.current_version(tenant, doc).await.unwrap();

        let texts = ["the quick brown fox jumps over the lazy dog"];
        let embs = embed(&texts).await;
        store
            .commit_chunks(tenant, doc, vid, &[chunk(0, texts[0])], &embs, &[0])
            .await
            .unwrap();
        store.finalize(tenant, doc, vid, 1, "stub-1024").await.unwrap();

        let retriever = HybridRetriever::new(pool.clone(), Arc::new(StubEmbedder));
        let q = RetrieveQuery { text: "quick brown fox".into(), profile_id: owner, top_k: None, doc_ids: None, inspect: true };
        let res = retriever.retrieve(tenant, None, &q, &RetrievalConfig::default()).await.unwrap();

        assert!(!res.chunks.is_empty(), "hybrid retrieve returned no chunks");
        let c = &res.chunks[0];
        assert_eq!(c.document_id, doc);
        assert!(c.scores.fused > 0.0, "fused RRF score should be positive");
        assert!(c.scores.bm25.is_some(), "bm25 leg should match 'fox'");
        assert!(res.stages.iter().any(|s| s.name == "fuse"));

        store.delete_document(tenant, doc).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn reingest_retires_prior_version_chunks() {
        let pool = pool().await;
        let store = DocStore::new(pool.clone());
        let tenant = Uuid::new_v4();
        let owner = Uuid::new_v4();
        let doc = register(&store, tenant, owner).await;
        let (v1, _, _) = store.current_version(tenant, doc).await.unwrap();

        let old = ["obsolete widget migration guide alpha"];
        store.commit_chunks(tenant, doc, v1, &[chunk(0, old[0])], &embed(&old).await, &[0]).await.unwrap();
        store.finalize(tenant, doc, v1, 1, "stub-1024").await.unwrap();

        // second version (new version_id) supersedes the first on commit
        let v2 = Uuid::new_v4();
        sqlx::query("insert into document_versions (tenant_id, id, document_id, version_no, storage_path, content_type, created_by) values ($1,$2,$3,2,'p','text/markdown','t')")
            .bind(tenant).bind(v2).bind(doc).execute(&pool).await.unwrap();
        let new = ["fresh widget migration guide beta"];
        store.commit_chunks(tenant, doc, v2, &[chunk(0, new[0])], &embed(&new).await, &[0]).await.unwrap();
        store.finalize(tenant, doc, v2, 1, "stub-1024").await.unwrap();

        let retriever = HybridRetriever::new(pool.clone(), Arc::new(StubEmbedder));
        let q = RetrieveQuery { text: "widget migration guide".into(), profile_id: owner, top_k: None, doc_ids: None, inspect: false };
        let res = retriever.retrieve(tenant, None, &q, &RetrievalConfig::default()).await.unwrap();
        assert!(res.chunks.iter().all(|c| c.text.contains("beta")), "retrieval returned a superseded (alpha) chunk");
        assert!(res.chunks.iter().any(|c| c.text.contains("beta")), "new version chunk missing");

        store.delete_document(tenant, doc).await.unwrap();
    }

    // helpers ------------------------------------------------------------------
    fn tenant_meta(_t: Uuid, owner: Uuid) -> NewDocument {
        NewDocument {
            title: Some("t".into()),
            original_filename: "a.md".into(),
            content_type: "text/markdown".into(),
            scope: "tenant".into(),
            classification: "internal".into(),
            space_id: None,
            collection_id: None,
            profile_id: owner,
        }
    }
    async fn register(store: &DocStore, tenant: Uuid, owner: Uuid) -> Uuid {
        store.register_document(tenant, &tenant_meta(tenant, owner)).await.unwrap().0
    }
}
