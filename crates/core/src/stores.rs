//! Opening torii's database: one pool, a tenant, and every orchestrator store for it.

use sqlx::PgPool;
use tenant_stores::{PgConfigStore, PgContentStore, PgContextStore, PgJournal, PgSchedulerStore};
use uuid::Uuid;

/// Connect one pool to torii's database, capped at `max` connections.
pub async fn connect(database_url: &str, max: u32) -> Result<PgPool, sqlx::Error> {
    tenant_stores::connect_with_max(database_url, max).await
}

/// Resolve an operator-supplied tenant — a UUID or a `core.tenants.slug` — to its id.
///
/// A UUID must name an existing tenant — a typo'd id must not silently open an empty, unrelated
/// scope that later writes would create rows under.
pub async fn resolve_tenant(pool: &PgPool, tenant: &str) -> anyhow::Result<Uuid> {
    let tenant = tenant.trim();
    let row: Option<(Uuid,)> = match Uuid::parse_str(tenant) {
        Ok(id) => {
            sqlx::query_as("select id from core.tenants where id = $1")
                .bind(id)
                .fetch_optional(pool)
                .await?
        }
        Err(_) => {
            sqlx::query_as("select id from core.tenants where slug = $1")
                .bind(tenant)
                .fetch_optional(pool)
                .await?
        }
    };
    row.map(|(id,)| id)
        .ok_or_else(|| anyhow::anyhow!("no tenant {tenant:?} (looked up as an id and as a slug)"))
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
    /// Every store for `tenant`, sharing `pool` (a `PgPool` clone is an `Arc` clone).
    pub fn open(pool: &PgPool, tenant: Uuid) -> Self {
        Self {
            journal: PgJournal::new(pool.clone(), tenant),
            content: PgContentStore::new(pool.clone(), tenant),
            context: PgContextStore::new(pool.clone(), tenant),
            scheduler: PgSchedulerStore::new(pool.clone(), tenant),
            config: PgConfigStore::new(pool.clone(), tenant),
        }
    }
}
