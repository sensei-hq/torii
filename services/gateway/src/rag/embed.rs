//! C5 · embedding — the single mock↔prod seam.
//!
//! [`EngineEmbedder`] is the prod path: config-driven embedding via the sensei engine's `TextEmbed`
//! capability over a named chain (model id + chain are operator config — no-hardcoded-ops).
//! [`StubEmbedder`] is the deterministic, hermetic test path (no model, no network). [`validate_dim`]
//! is THE enforcement layer: the crate reads the model's output shape at runtime and performs no
//! dimension check, so a mis-configured (non-1024-dim) model is caught here — fail-closed — rather
//! than corrupting the `vector(1024)` index.

use std::sync::Arc;

use async_trait::async_trait;
use sha2::{Digest, Sha256};

use super::{RagError, EMBED_DIM};

/// Produces embeddings for a batch of texts. `dim()` is the expected output dimensionality.
#[async_trait]
pub trait Embedder: Send + Sync {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, RagError>;
    fn dim(&self) -> usize {
        EMBED_DIM
    }
}

/// Validate a single embedding row's dimensionality (fail-closed).
pub fn validate_dim(v: &[f32]) -> Result<(), RagError> {
    if v.len() != EMBED_DIM {
        return Err(RagError::Dim { expected: EMBED_DIM, got: v.len() });
    }
    Ok(())
}

/// Validate every row of a batch (used before the `vector(1024)` bind in `DocStore::insert_chunks`).
pub fn validate_dims(rows: &[Vec<f32>]) -> Result<(), RagError> {
    for r in rows {
        validate_dim(r)?;
    }
    Ok(())
}

/// Deterministic, hermetic embedder for unit/integration tests: SHA-256(text) seeds an xorshift PRNG
/// that fills exactly [`EMBED_DIM`] f32 in [-1, 1], then L2-normalizes. Identical text → identical
/// vector (so tests can seed two tenants with the SAME vector to prove cross-tenant isolation). No
/// model, no network.
pub struct StubEmbedder;

#[async_trait]
impl Embedder for StubEmbedder {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, RagError> {
        Ok(texts.iter().map(|t| stub_vector(t)).collect())
    }
}

fn stub_vector(text: &str) -> Vec<f32> {
    let digest = Sha256::digest(text.as_bytes());
    // seed the PRNG from the first 8 bytes of the digest (force odd/non-zero).
    let mut state = u64::from_le_bytes(digest[0..8].try_into().unwrap()) | 1;
    let mut v = Vec::with_capacity(EMBED_DIM);
    for _ in 0..EMBED_DIM {
        // xorshift64*
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let r = state.wrapping_mul(0x2545F491_4F6CDD1D);
        // top 53 bits → [0,1) → [-1,1]
        let unit = (r >> 11) as f64 / (1u64 << 53) as f64;
        v.push((unit as f32) * 2.0 - 1.0);
    }
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in &mut v {
            *x /= norm;
        }
    }
    v
}

/// A stub that returns the WRONG dimensionality — exercises the [`validate_dim`] failure path.
pub struct WrongDimStubEmbedder(pub usize);

#[async_trait]
impl Embedder for WrongDimStubEmbedder {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, RagError> {
        Ok(texts.iter().map(|_| vec![0.0f32; self.0]).collect())
    }
    fn dim(&self) -> usize {
        self.0
    }
}

/// Prod embedder: config-driven embedding via the sensei engine over a named chain. The model id
/// (default `mxbai-embed-large`, 1024-dim) + chain are operator config (no-hardcoded-ops); the same
/// `EngineEmbedder` serves whether the chain binds an in-process embedded model (feature
/// `embed-local`) or a cloud/ollama model.
pub struct EngineEmbedder {
    gw: Arc<gateway::Gateway>,
    chain: String,
}

impl EngineEmbedder {
    pub fn new(gw: Arc<gateway::Gateway>, chain: String) -> Self {
        Self { gw, chain }
    }
}

#[async_trait]
impl Embedder for EngineEmbedder {
    async fn embed(&self, _texts: &[String]) -> Result<Vec<Vec<f32>>, RagError> {
        // Phase C: build InferenceRequest { capability: Capability::TextEmbed, chain: Some(self.chain),
        // payload: Payload::Embed { texts }, allow_fallback: true, .. } → self.gw.execute(&req) →
        // resp.embeddings.ok_or(Embed)?, then validate_dims(&rows)?.
        let _ = (&self.gw, &self.chain);
        Err(RagError::Unsupported("EngineEmbedder is wired in Phase C"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stub_is_1024_deterministic_normalized() {
        let e = StubEmbedder;
        let a = e.embed(&["hello world".to_string()]).await.unwrap();
        let b = e.embed(&["hello world".to_string()]).await.unwrap();
        assert_eq!(a[0].len(), EMBED_DIM);
        assert_eq!(a, b, "deterministic across calls");
        let norm: f32 = a[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "L2-normalized, got {norm}");
    }

    #[test]
    fn validate_dim_rejects_wrong_sizes() {
        assert!(validate_dim(&vec![0.0; EMBED_DIM]).is_ok());
        for bad in [384usize, 768, 1536] {
            match validate_dim(&vec![0.0; bad]) {
                Err(RagError::Dim { expected, got }) => {
                    assert_eq!(expected, EMBED_DIM);
                    assert_eq!(got, bad);
                }
                other => panic!("expected Dim error for {bad}, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn identical_text_same_vector_distinct_text_differs() {
        let e = StubEmbedder;
        let same = e
            .embed(&["roadmap alpha".to_string(), "roadmap alpha".to_string()])
            .await
            .unwrap();
        let dot: f32 = same[0].iter().zip(&same[1]).map(|(x, y)| x * y).sum();
        assert!(dot > 0.999, "identical text → cosine ~1, got {dot}");

        let diff = e.embed(&["totally different content".to_string()]).await.unwrap();
        let dot2: f32 = same[0].iter().zip(&diff[0]).map(|(x, y)| x * y).sum();
        assert!(dot2.abs() < 0.2, "distinct text → near-orthogonal, got {dot2}");
    }

    #[tokio::test]
    async fn wrong_dim_stub_fails_validation() {
        let rows = WrongDimStubEmbedder(768).embed(&["x".to_string()]).await.unwrap();
        assert!(matches!(validate_dims(&rows), Err(RagError::Dim { got: 768, .. })));
    }
}
