use std::sync::Arc;
use gateway::Gateway;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub gateway: Arc<Gateway>,
}

pub type SharedState = Arc<AppState>;
