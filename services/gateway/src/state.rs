use std::collections::HashMap;
use std::sync::Arc;

use gateway::Gateway;
use jsonwebtoken::jwk::JwkSet;
use sqlx::PgPool;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::vault::Vault;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub gateway: Arc<Gateway>,
    /// Cached JWKS from Supabase, protected by an RwLock for lazy refetch on
    /// key-rotation (kid miss). Updated in-place by the auth middleware.
    pub jwks: RwLock<JwkSet>,
    /// F3 per-tenant BYOK credential cache. `None` vault ⇒ BYOK disabled (no KEK) —
    /// `get` returns an empty map and the engine uses the platform/env keys.
    pub tenant_keys: TenantKeyCache,
}

pub type SharedState = Arc<AppState>;

/// Caches each tenant's decrypted `router_name → api_key` map (F3 BYOK). Filled on
/// miss from the vault; invalidated on any credential write. Small (a few short
/// strings per tenant) — no eviction at v1 scale.
pub struct TenantKeyCache {
    vault: Option<Vault>,
    cache: RwLock<HashMap<Uuid, Arc<HashMap<String, String>>>>,
}

impl TenantKeyCache {
    pub fn new(vault: Option<Vault>) -> Self {
        Self {
            vault,
            cache: RwLock::new(HashMap::new()),
        }
    }

    /// The tenant's decrypted BYOK keys (`router_name → api_key`), memoized. Empty
    /// when BYOK is disabled (no vault) or the tenant stored none. A vault error
    /// (e.g. a DEK sealed under a non-matching KEK) is surfaced to the caller, which
    /// falls back to platform keys — a bad BYOK setup never denies inference.
    pub async fn get(
        &self,
        pool: &PgPool,
        tenant: Uuid,
    ) -> anyhow::Result<Arc<HashMap<String, String>>> {
        let Some(vault) = &self.vault else {
            return Ok(Arc::new(HashMap::new()));
        };
        if let Some(hit) = self.cache.read().await.get(&tenant).cloned() {
            return Ok(hit);
        }
        let map = Arc::new(vault.resolve_tenant_keys(pool, tenant).await?);
        self.cache.write().await.insert(tenant, map.clone());
        Ok(map)
    }

    /// Drop the tenant's cached map so the next `get` re-decrypts (after a write).
    pub async fn invalidate(&self, tenant: Uuid) {
        self.cache.write().await.remove(&tenant);
    }

    /// Store/rotate a BYOK key then invalidate the cache. Errors if BYOK is disabled.
    pub async fn store(
        &self,
        pool: &PgPool,
        tenant: Uuid,
        router_id: Uuid,
        label: Option<&str>,
        key: &str,
        actor: &str,
    ) -> anyhow::Result<Uuid> {
        let vault = self
            .vault
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("vault unavailable (no KEK)"))?;
        let id = vault
            .store_router_key(pool, tenant, router_id, label, key, actor)
            .await?;
        self.invalidate(tenant).await;
        Ok(id)
    }

    /// Revoke a BYOK key then invalidate the cache. Errors if BYOK is disabled.
    pub async fn revoke(
        &self,
        pool: &PgPool,
        tenant: Uuid,
        router_id: Uuid,
        actor: &str,
    ) -> anyhow::Result<()> {
        let vault = self
            .vault
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("vault unavailable (no KEK)"))?;
        vault
            .revoke_router_key(pool, tenant, router_id, actor)
            .await?;
        self.invalidate(tenant).await;
        Ok(())
    }
}

#[cfg(test)]
mod integration {
    //! Hits the local Supabase DB (55322). Ignored by default — run with:
    //!   `cargo test -p torii-gateway -- --ignored cache_`
    use super::*;
    use crate::crypto::Kek;
    use sqlx::postgres::PgPoolOptions;

    async fn pool() -> PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    async fn temp_tenant(pool: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) \
             values ($1, 'cache-test', $2, 'cache-test')",
        )
        .bind(id)
        .bind(format!("cache-test-{id}"))
        .execute(pool)
        .await
        .expect("insert temp tenant");
        id
    }

    async fn cleanup(pool: &PgPool, tenant: Uuid) {
        for stmt in [
            "delete from public.router_credentials where tenant_id = $1",
            "delete from core.tenant_keys where tenant_id = $1",
            "delete from core.tenants where id = $1",
        ] {
            sqlx::query(stmt).bind(tenant).execute(pool).await.unwrap();
        }
    }

    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn cache_isolates_tenants_and_invalidate_refreshes() {
        let pool = pool().await;
        let kek = [3u8; 32];
        let cache = TenantKeyCache::new(Some(Vault::with_kek(Kek::from_bytes(kek))));
        // a second vault (same KEK) to mutate the DB *behind the cache's back*.
        let side = Vault::with_kek(Kek::from_bytes(kek));
        let router: Uuid = sqlx::query_scalar("select id from config.routers where name='openai'")
            .fetch_one(&pool)
            .await
            .unwrap();
        let (a, b) = (temp_tenant(&pool).await, temp_tenant(&pool).await);

        cache
            .store(&pool, a, router, None, "kA", "t")
            .await
            .unwrap();
        cache
            .store(&pool, b, router, None, "kB", "t")
            .await
            .unwrap();

        // isolation: each tenant sees only its own key.
        let key = |m: &std::collections::HashMap<String, String>| m.get("openai").cloned();
        assert_eq!(
            key(&cache.get(&pool, a).await.unwrap()).as_deref(),
            Some("kA")
        );
        assert_eq!(
            key(&cache.get(&pool, b).await.unwrap()).as_deref(),
            Some("kB")
        );

        // memoization: a change made behind the cache is NOT seen until invalidate.
        side.store_router_key(&pool, a, router, None, "kA2", "t")
            .await
            .unwrap();
        assert_eq!(
            key(&cache.get(&pool, a).await.unwrap()).as_deref(),
            Some("kA"),
            "stale cached value served before invalidate"
        );
        cache.invalidate(a).await;
        assert_eq!(
            key(&cache.get(&pool, a).await.unwrap()).as_deref(),
            Some("kA2"),
            "re-decrypted after invalidate"
        );

        cleanup(&pool, a).await;
        cleanup(&pool, b).await;
    }
}
