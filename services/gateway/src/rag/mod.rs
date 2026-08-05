//! C5 · RAG core — ingestion pipeline, embedding, and hybrid retrieval.
//!
//! See `docs/plans/C5-rag-backend-build-plan.md` (build plan) and
//! `docs/specs/C5-rag-document-intelligence.md` (contract). No-hardcoded-ops: every knob
//! (chunk size/overlap, k_dense/k_bm25/k_out, rrf_k, match_threshold, embed model/chain) resolves
//! from per-space config over the fallback consts below — changing config changes behaviour with no
//! code change. Security invariants (enforced in SQL + the handlers, never UI-only): a hard
//! per-tenant filter in `hybrid_search` (cross-tenant recall = 0), the fixed 4-level classification,
//! and redact-at-rest before embedding (no raw secret ever reaches `document_embeddings`).

pub mod chunk;
pub mod embed;
pub mod ingest;
pub mod parse;
pub mod retrieve;
pub mod secure;
pub mod signals;
pub mod storage;
pub mod store;

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

/// Embedding dimensionality — a FIXED, model-determined contract (`document_embeddings vector(1024)`),
/// validated on every embed (the sensei crate reads the model's output shape at runtime and performs
/// no dimension check, so this is THE enforcement point). NOT a config knob.
pub const EMBED_DIM: usize = 1024;

// Fallback retrieval + chunk constants (DECISIONS §8 "resolved") — overridable per space.
pub const DEFAULT_RRF_K: i32 = 60;
pub const DEFAULT_K_DENSE: i32 = 100;
pub const DEFAULT_K_BM25: i32 = 100;
pub const DEFAULT_K_OUT: i32 = 20;
pub const DEFAULT_MATCH_THRESHOLD: f32 = 0.0;
pub const DEFAULT_CHUNK_TOKENS: usize = 512;
pub const DEFAULT_OVERLAP_PCT: f32 = 0.15;

/// The single error type across the RAG module tree.
#[derive(Debug, thiserror::Error)]
pub enum RagError {
    #[error("parse: {0}")]
    Parse(String),
    #[error("unsupported: {0}")]
    Unsupported(&'static str),
    #[error("embed: {0}")]
    Embed(String),
    #[error("embedding dim {got} != expected {expected}")]
    Dim { expected: usize, got: usize },
    #[error("storage: {0}")]
    Storage(String),
    #[error("db: {0}")]
    Db(#[from] sqlx::Error),
}

/// Resolved per-space retrieval configuration (no-hardcoded-ops). `Default` is the fallback the
/// resolver returns when a space has no `settings(scope='space', key='retrieval')` row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalConfig {
    pub mode: String,
    pub k_dense: i32,
    pub k_bm25: i32,
    pub k_out: i32,
    pub rrf_k: i32,
    pub match_threshold: f32,
    pub rerank: Option<String>,
}

impl Default for RetrievalConfig {
    fn default() -> Self {
        Self {
            mode: "hybrid".into(),
            k_dense: DEFAULT_K_DENSE,
            k_bm25: DEFAULT_K_BM25,
            k_out: DEFAULT_K_OUT,
            rrf_k: DEFAULT_RRF_K,
            match_threshold: DEFAULT_MATCH_THRESHOLD,
            rerank: None,
        }
    }
}

/// Resolved per-space chunking configuration (no-hardcoded-ops).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkConfig {
    pub strategy: String,
    pub target_tokens: usize,
    pub overlap_pct: f32,
    pub tables_whole: bool,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            strategy: "structural".into(),
            target_tokens: DEFAULT_CHUNK_TOKENS,
            overlap_pct: DEFAULT_OVERLAP_PCT,
            tables_whole: true,
        }
    }
}

/// Resolve the per-space retrieval config from `governance.settings(scope='space', key='retrieval')`
/// over the [`RetrievalConfig::default`] fallback (no-hardcoded-ops — an admin's
/// `POST /rpc/retrieval/set-config` changes behaviour with no code change). Absent / malformed /
/// no-space → the fallback (never panics; a config read must never break retrieval).
pub async fn resolve_retrieval_config(pool: &PgPool, tenant: Uuid, space: Option<Uuid>) -> RetrievalConfig {
    let mut cfg = RetrievalConfig::default();
    let Some(space) = space else { return cfg };
    let row: Option<(serde_json::Value,)> = sqlx::query_as(
        "select value from governance.settings \
         where tenant_id = $1 and scope = 'space' and space_id = $2 and key = 'retrieval'",
    )
    .bind(tenant)
    .bind(space)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    if let Some((v,)) = row {
        if let Some(x) = v.get("mode").and_then(|x| x.as_str()) { cfg.mode = x.to_string(); }
        if let Some(x) = v.get("k_dense").and_then(|x| x.as_i64()) { cfg.k_dense = x as i32; }
        if let Some(x) = v.get("k_bm25").and_then(|x| x.as_i64()) { cfg.k_bm25 = x as i32; }
        if let Some(x) = v.get("k_out").and_then(|x| x.as_i64()) { cfg.k_out = x as i32; }
        if let Some(x) = v.get("rrf_k").and_then(|x| x.as_i64()) { cfg.rrf_k = x as i32; }
        if let Some(x) = v.get("match_threshold").and_then(|x| x.as_f64()) { cfg.match_threshold = x as f32; }
        if let Some(x) = v.get("rerank").and_then(|x| x.as_str()) { cfg.rerank = Some(x.to_string()); }
    }
    cfg
}

/// Resolve the per-space chunk config from the same `retrieval` settings row's `chunker` sub-object
/// (falls back to the top-level object, then to [`ChunkConfig::default`]).
pub async fn resolve_chunk_config(pool: &PgPool, tenant: Uuid, space: Option<Uuid>) -> ChunkConfig {
    let mut cfg = ChunkConfig::default();
    let Some(space) = space else { return cfg };
    let row: Option<(serde_json::Value,)> = sqlx::query_as(
        "select value from governance.settings \
         where tenant_id = $1 and scope = 'space' and space_id = $2 and key = 'retrieval'",
    )
    .bind(tenant)
    .bind(space)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    if let Some((v,)) = row {
        let ch = v.get("chunker").cloned().unwrap_or(v);
        if let Some(x) = ch.get("strategy").and_then(|x| x.as_str()) { cfg.strategy = x.to_string(); }
        if let Some(x) = ch.get("target_tokens").and_then(|x| x.as_u64()) { cfg.target_tokens = x as usize; }
        if let Some(x) = ch.get("overlap_pct").and_then(|x| x.as_f64()) { cfg.overlap_pct = x as f32; }
        if let Some(x) = ch.get("tables_whole").and_then(|x| x.as_bool()) { cfg.tables_whole = x; }
    }
    cfg
}
