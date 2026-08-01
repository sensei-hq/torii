//! C5 · §3c secure structured-data compute — DEFERRED seam.
//!
//! The `datasets`/`dataset_columns`/`dataset_safe_schema` tables already exist, but the
//! schema-to-LLM → sandboxed DuckDB SELECT-only → k-anon-gated compute path is out of this run's
//! scope (DECISIONS §3c; build plan deferrals). The trait fixes the interface so the executor plugs
//! in later without touching callers; v1 returns [`RagError::Unsupported`]. No `/v1/datasets/:id/compute`
//! route is mounted and the `dataset.compute` capability is not requested.

use super::RagError;

/// A validated, read-only query plan (text-to-SQL/formula) — shape filled in when §3c lands.
pub struct Plan;
/// A handle to a per-tenant dataset in the trusted boundary (DEK-decrypted only here) — deferred.
pub struct DatasetHandle;
/// An aggregate/derived result that has passed the k-anon + W5 redaction gates — deferred.
pub struct GatedResult;

/// Sandboxed, read-only executor for §3c plans (SELECT-only AST allow-list, statement timeout,
/// row/cost caps). Deferred: the only impl in v1 is [`NoopSecureExecutor`].
pub trait SecureExecutor: Send + Sync {
    fn execute(&self, plan: &Plan, ds: &DatasetHandle) -> Result<GatedResult, RagError>;
}

/// v1 no-op: §3c compute is deferred (fail-closed).
pub struct NoopSecureExecutor;

impl SecureExecutor for NoopSecureExecutor {
    fn execute(&self, _plan: &Plan, _ds: &DatasetHandle) -> Result<GatedResult, RagError> {
        Err(RagError::Unsupported("§3c dataset compute is deferred (v1)"))
    }
}
