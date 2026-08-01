use std::sync::Arc;

use gateway::Gateway;
use jsonwebtoken::jwk::JwkSet;
use sqlx::PgPool;
use tokio::sync::RwLock;
use vault::kek::KekError;
use vault::{EnvKekProvider, KekProvider, PostgresVaultStore, Profile, SupabaseVaultKekProvider, Vault};
use zeroize::Zeroizing;

/// Default Supabase-Vault secret name holding the base64 KEK in prod. Operator-overridable via
/// `TORII_KEK_VAULT_SECRET` (no hardcoded ops — this is just the fallback).
const DEFAULT_KEK_VAULT_SECRET: &str = "torii_kek";

/// The gateway's runtime KEK source: a dev env KEK, or the prod Supabase-Vault-backed KEK
/// (torii#17). One enum so `AppState` holds a single concrete cache type while the provider is
/// chosen at startup by deployment profile.
pub enum GatewayKek {
    Env(EnvKekProvider),
    Vault(SupabaseVaultKekProvider),
}

impl KekProvider for GatewayKek {
    fn kek(&self) -> Result<Zeroizing<[u8; 32]>, KekError> {
        match self {
            GatewayKek::Env(p) => p.kek(),
            GatewayKek::Vault(p) => p.kek(),
        }
    }
}

/// The F3 BYOK cache, specialized for the gateway: the runtime KEK ([`GatewayKek`]) + the
/// Postgres store over `core.tenant_keys` / `public.router_credentials`. The cache, envelope
/// crypto, and rotation all live in the shared `sensei-vault` crate (V5); the gateway only pins
/// the concrete `K`/`S`.
pub type TenantKeyCache = vault::TenantKeyCache<GatewayKek, PostgresVaultStore>;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub gateway: Arc<Gateway>,
    /// Cached JWKS from Supabase, protected by an RwLock for lazy refetch on
    /// key-rotation (kid miss). Updated in-place by the auth middleware.
    pub jwks: RwLock<JwkSet>,
    /// F3 per-tenant BYOK credential cache. `None` vault ⇒ BYOK disabled (no KEK) —
    /// `get` returns an empty map and the engine uses the platform/env keys.
    pub tenant_keys: TenantKeyCache,
    /// C5 RAG · config-driven query/document embedder (the single mock↔prod seam). The same
    /// `Arc<dyn Embedder>` backs both the ingest pipeline and the retriever.
    pub embedder: Arc<dyn crate::rag::embed::Embedder>,
    /// C5 RAG · object storage for document originals + derived artifacts (signed upload/download).
    pub object_store: Arc<dyn crate::rag::storage::ObjectStore>,
    /// C5 RAG · ingestion orchestrator (parse → redact-at-rest → chunk → embed → index), spawned
    /// per `POST /v1/documents/:id/ingest`.
    pub ingestor: Arc<crate::rag::ingest::Ingestor>,
    /// C5 RAG · hybrid retrieval engine (dense pgvector + BM25 fused by RRF, isolation in-query).
    pub retriever: Arc<dyn crate::rag::retrieve::RetrievalEngine>,
}

pub type SharedState = Arc<AppState>;

/// Build the F3 BYOK cache, choosing the KEK source by deployment (`TORII_ENV`, default `dev` —
/// the same var the rest of the gateway reads):
///
/// - **prod** — the KEK is read from **Supabase Vault** ([`SupabaseVaultKekProvider`], torii#17)
///   under the secret named by `TORII_KEK_VAULT_SECRET` (default `torii_kek`); it never sits raw
///   in the process env. A raw env `TORII_KEK` is refused in prod (the crate's gap #1).
/// - **dev / anything else** — a base64 env KEK (`TORII_KEK`).
///
/// Any failure (missing/invalid KEK, unreadable vault secret) disables BYOK without failing
/// startup: the cache is built with no vault so platform/env keys still serve — a bad BYOK setup
/// never denies inference.
pub async fn build_tenant_key_cache(pool: PgPool) -> TenantKeyCache {
    let env = std::env::var("TORII_ENV").unwrap_or_else(|_| "dev".to_string());
    let kek = resolve_kek(&pool, &env).await;
    TenantKeyCache::new(kek.map(|k| Vault::new(k, PostgresVaultStore::new(pool))))
}

/// Resolve the KEK provider for the deployment, or `None` (BYOK disabled) on any failure.
async fn resolve_kek(pool: &PgPool, env: &str) -> Option<GatewayKek> {
    if env == "prod" {
        let secret = std::env::var("TORII_KEK_VAULT_SECRET")
            .unwrap_or_else(|_| DEFAULT_KEK_VAULT_SECRET.to_string());
        match SupabaseVaultKekProvider::connect(pool, &secret).await {
            Ok(p) => {
                tracing::info!("F3 vault: enabled (prod KEK from Supabase Vault `{secret}`)");
                Some(GatewayKek::Vault(p))
            }
            Err(e) => {
                tracing::warn!("F3 vault disabled (prod KEK `{secret}` unavailable: {e})");
                None
            }
        }
    } else {
        match EnvKekProvider::from_env("TORII_KEK", Profile::Dev) {
            Ok(p) => {
                tracing::info!("F3 vault: enabled (dev env KEK)");
                Some(GatewayKek::Env(p))
            }
            Err(e) => {
                tracing::warn!("F3 vault disabled (no/invalid env KEK: {e}); BYOK unavailable");
                None
            }
        }
    }
}

#[cfg(test)]
mod integration {
    //! Hits local Supabase (55322). Ignored by default — run with:
    //!   `cargo test -p torii-gateway -- --ignored prod_kek`
    use super::*;
    use base64::Engine;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    async fn pool() -> PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn prod_kek_comes_from_supabase_vault_and_byok_round_trips() {
        let pool = pool().await;
        let raw = [0x42u8; 32];
        let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
        // Seed the default-named Supabase-Vault secret with a known KEK.
        sqlx::query("delete from vault.secrets where name = $1")
            .bind(DEFAULT_KEK_VAULT_SECRET)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("select vault.create_secret($1, $2, 'gateway prod-kek test')")
            .bind(&b64)
            .bind(DEFAULT_KEK_VAULT_SECRET)
            .execute(&pool)
            .await
            .unwrap();

        // prod resolves the KEK from Supabase Vault (not the env) and serves exactly it.
        let kek = resolve_kek(&pool, "prod")
            .await
            .expect("prod KEK resolved from Supabase Vault");
        assert!(matches!(kek, GatewayKek::Vault(_)));
        assert_eq!(*kek.kek().unwrap(), raw);

        // End-to-end: a cache built on the prod KEK stores + resolves a BYOK key.
        let cache = TenantKeyCache::new(Some(Vault::new(kek, PostgresVaultStore::new(pool.clone()))));
        let tenant = Uuid::new_v4();
        let router: Uuid = sqlx::query_scalar("select id from config.routers where name = 'openai'")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) \
             values ($1, 'gw-prodkek', $2, 'test')",
        )
        .bind(tenant)
        .bind(format!("gw-prodkek-{tenant}"))
        .execute(&pool)
        .await
        .unwrap();
        cache
            .store(tenant, router, Some("byok"), "sk-prod-AAA", "tester")
            .await
            .unwrap();
        assert_eq!(
            cache
                .get(tenant)
                .await
                .unwrap()
                .get("openai")
                .map(String::as_str),
            Some("sk-prod-AAA")
        );

        // cleanup (FK-safe order + the seeded secret).
        for stmt in [
            "delete from public.router_credentials where tenant_id = $1",
            "delete from core.tenant_key_archive where tenant_id = $1",
            "delete from core.tenant_keys where tenant_id = $1",
            "delete from core.tenants where id = $1",
        ] {
            sqlx::query(stmt).bind(tenant).execute(&pool).await.unwrap();
        }
        sqlx::query("delete from vault.secrets where name = $1")
            .bind(DEFAULT_KEK_VAULT_SECRET)
            .execute(&pool)
            .await
            .unwrap();
    }
}
