//! Tenant-scoped Postgres stores for the gateway orchestrator (TM-7, torii#25).
//!
//! The gateway is a library; torii owns persistence (`docs/DECISIONS.md` §11). The gateway's
//! `orchestrator-core` defines the persistence traits and ships in-memory stores; this crate
//! implements those traits over torii's `registry.*` + `runs.*` schemas (TM-6). Ported from the
//! gateway's single-tenant `orchestrator-store` Postgres adapters, keeping their exactly-once,
//! compare-and-swap and format-fence behaviour.
//!
//! **Tenancy.** Every store is constructed for ONE tenant (`new(pool, tenant)`) and every
//! statement it issues carries `tenant_id = $1` — in the key, the predicate and the conflict
//! target. The traits take no tenant, so a store-wide operation (`claim_due`, `list_paused`,
//! pruning, the registry generation) is a per-tenant one: a worker serving several tenants holds
//! one set of stores per tenant. The service connects as the table owner, so RLS does not apply
//! to it; the `tenant_id` predicate is the isolation, and `tests/isolation.rs` proves it.
//!
//! Sqlx RUNTIME queries (not the compile-time macros), so the crate builds with no database.

mod config;
mod content;
mod journal;
mod scheduler;

pub use config::PgConfigStore;
pub use content::{PgContentStore, PgContextStore};
pub use journal::PgJournal;
pub use scheduler::PgSchedulerStore;

use orchestrator_core::OrchestratorError;
use sqlx::postgres::{PgPool, PgPoolOptions};

/// The default pool cap [`connect`] uses: one pool is shared by every store of a worker, so this
/// is the worker's whole connection budget. [`connect_with_max`] raises it.
const DEFAULT_MAX_CONNECTIONS: u32 = 8;

/// Connect a pool to `database_url` (torii's schema must be applied), capped at 8 connections.
pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    connect_with_max(database_url, DEFAULT_MAX_CONNECTIONS).await
}

/// Connect a pool to `database_url`, capped at `max` connections.
pub async fn connect_with_max(database_url: &str, max: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(max)
        .connect(database_url)
        .await
}

/// A transport error on a CAS / context / config-write / scheduler path → the loud
/// `Store(..)` channel (distinct from the journal's `Backend`). Never swallowed.
pub(crate) fn store_err(e: sqlx::Error) -> OrchestratorError {
    OrchestratorError::Store(e.to_string())
}

/// A serialization error on a WRITE path → the same `Store` channel.
pub(crate) fn store_err_ser(e: serde_json::Error) -> OrchestratorError {
    OrchestratorError::Store(e.to_string())
}
