//! Opening torii's database: one pool, a tenant, and every orchestrator store for it.

use sqlx::PgPool;
use tenant_stores::{PgConfigStore, PgContentStore, PgContextStore, PgJournal, PgSchedulerStore};
use uuid::Uuid;

/// Connect one pool to torii's database, capped at `max` connections.
pub async fn connect(database_url: &str, max: u32) -> Result<PgPool, sqlx::Error> {
    tenant_stores::connect_with_max(database_url, max).await
}

/// Resolve an operator-supplied tenant — a UUID or a `core.tenants.slug` — to its id.
pub async fn resolve_tenant(_pool: &PgPool, _tenant: &str) -> anyhow::Result<Uuid> {
    anyhow::bail!("not implemented")
}

/// Every orchestrator store of ONE tenant, over one pool.
pub struct TenantStores {
    pub journal: PgJournal,
    pub content: PgContentStore,
    pub context: PgContextStore,
    pub scheduler: PgSchedulerStore,
    pub config: PgConfigStore,
}

impl TenantStores {
    pub fn open(_pool: &PgPool, _tenant: Uuid) -> Self {
        todo!()
    }
}
