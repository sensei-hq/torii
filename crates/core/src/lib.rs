//! Torii's shared Rust data layer (TM-8, torii#26).
//!
//! The API (`services/gateway`) and the operator CLI read torii's database through this crate
//! and nothing else, so they cannot drift into two implementations of "what the config is".

use gateway::types::config::GatewayConfig;

/// Build the gateway config from torii's catalog.
pub async fn load_gateway_config(_pool: &sqlx::PgPool) -> anyhow::Result<GatewayConfig> {
    anyhow::bail!("not yet moved from services/gateway")
}
