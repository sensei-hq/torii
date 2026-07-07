use std::sync::Arc;

use gateway::Gateway;
use jsonwebtoken::jwk::JwkSet;
use tokio::sync::RwLock;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub gateway: Arc<Gateway>,
    /// Cached JWKS from Supabase, protected by an RwLock for lazy refetch on
    /// key-rotation (kid miss). Updated in-place by the auth middleware.
    pub jwks: RwLock<JwkSet>,
}

pub type SharedState = Arc<AppState>;
