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
pub mod parse;
pub mod secure;
pub mod signals;
pub mod storage;

use serde::{Deserialize, Serialize};

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
