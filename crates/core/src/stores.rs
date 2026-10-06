//! Opening torii's database: one pool, a tenant, and every orchestrator store for it.

use sqlx::PgPool;
pub use tenant_stores::{
    PgConfigStore, PgContentStore, PgContextStore, PgJournal, PgSchedulerStore,
};
use uuid::Uuid;

/// Connect one pool to torii's database, capped at `max` connections.
pub async fn connect(database_url: &str, max: u32) -> Result<PgPool, sqlx::Error> {
    tenant_stores::connect_with_max(database_url, max).await
}

/// Resolve an operator-supplied tenant — a UUID or a `core.tenants.slug` — to its id.
///
/// Matched against BOTH columns, always: slugs are free text, so a slug can look exactly like
/// another tenant's id (an org can be named after one). An input matching one tenant by id and
/// a DIFFERENT tenant by slug is refused as ambiguous, naming both — never silently resolved to
/// either. A typo'd id that matches nothing is refused too, rather than opening an empty scope.
pub async fn resolve_tenant(pool: &PgPool, tenant: &str) -> anyhow::Result<Uuid> {
    let tenant = tenant.trim();
    let as_id = Uuid::parse_str(tenant).ok();
    let rows: Vec<(Uuid,)> =
        sqlx::query_as("select id from core.tenants where id = $1 or slug = $2 order by id")
            .bind(as_id)
            .bind(tenant)
            .fetch_all(pool)
            .await?;
    match rows.as_slice() {
        [(id,)] => Ok(*id),
        [] => Err(anyhow::anyhow!(
            "no tenant {tenant:?} (looked up as an id and as a slug)"
        )),
        many => Err(anyhow::anyhow!(
            "tenant {tenant:?} is ambiguous: it is one tenant's id and another's slug ({}) — \
             name the tenant by its id",
            many.iter()
                .map(|(id,)| id.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
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
