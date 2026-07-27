use std::sync::Arc;

use gateway::Gateway;
use jsonwebtoken::jwk::JwkSet;
use sqlx::PgPool;
use tokio::sync::RwLock;
use vault::{EnvKekProvider, PostgresVaultStore, Profile, Vault};

/// The F3 BYOK cache, specialized for the gateway: an env-sourced KEK + the Postgres store
/// over `core.tenant_keys` / `public.router_credentials`. The cache itself, the envelope
/// crypto, and rotation all live in the shared `sensei-vault` crate (V5); the gateway only
/// pins the concrete `K`/`S`.
pub type TenantKeyCache = vault::TenantKeyCache<EnvKekProvider, PostgresVaultStore>;

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

/// Build the F3 BYOK cache from the environment KEK. `TORII_KEK` (base64 32 bytes), with the
/// legacy `STRATEGOS_KEK` as a fallback; the deployment profile is `TORII_PROFILE` (default
/// `dev`). Under a `prod` profile a raw env KEK is refused (the crate's gap #1 fail-closed) →
/// the cache is built with no vault (BYOK disabled; platform/env keys still serve) until a
/// KMS-backed KEK is wired. An absent/invalid KEK in dev likewise disables BYOK without
/// failing startup — a bad BYOK setup never denies inference.
pub fn build_tenant_key_cache(pool: PgPool) -> TenantKeyCache {
    let profile = match std::env::var("TORII_PROFILE").as_deref() {
        Ok("prod") => Profile::Prod,
        _ => Profile::Dev,
    };
    match EnvKekProvider::from_env("TORII_KEK", profile)
        .or_else(|_| EnvKekProvider::from_env("STRATEGOS_KEK", profile))
    {
        Ok(kek) => {
            tracing::info!("F3 vault: enabled (per-tenant BYOK active)");
            TenantKeyCache::new(Some(Vault::new(kek, PostgresVaultStore::new(pool))))
        }
        Err(e) => {
            tracing::warn!("F3 vault disabled (no/invalid KEK: {e}); BYOK unavailable");
            TenantKeyCache::new(None)
        }
    }
}
