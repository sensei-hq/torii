//! Provider key resolution for gateway routers.
//!
//! Resolves each router's `api_key_env` (the env-var name stored in
//! `RouterConfig`) to a live key value via `std::env::var` at call time.
//!
//! The `GatewayConfig` already carries the env-var name per router
//! (populated by `config_loader::build_routers` from `config.routers.api_key_env_var`).
//! This module bridges that name to the actual secret present in the process
//! environment so `Gateway::refresh_router_keys` can inject it.
//!
//! # TODO(F3): replace env resolution with the router_keys AES-GCM vault decryption

use std::collections::HashMap;

use gateway::types::config::GatewayConfig;

/// Build a `router_id → env_var_name` map from the loaded [`GatewayConfig`].
///
/// Only routers that have a non-`None` `api_key_env` field are included.
/// Routers with no configured env var (e.g. `ollama`, which uses no API key)
/// are omitted — the resolver will return `None` for them automatically.
pub fn router_env_map(config: &GatewayConfig) -> HashMap<String, String> {
    config
        .routers
        .iter()
        .filter_map(|(id, router)| {
            router
                .api_key_env
                .as_ref()
                .map(|env_var| (id.clone(), env_var.clone()))
        })
        .collect()
}

/// Build a resolver closure that maps `router_id → Option<api_key>`.
///
/// The closure looks up the router id in `router_env` to find the env-var
/// name, then reads the live value via `std::env::var`. An empty string is
/// treated as absent (returns `None`) so placeholder entries in `.env` files
/// don't accidentally propagate as keys.
///
/// # TODO(F3): replace env resolution with the router_keys AES-GCM vault decryption
pub fn env_key_resolver(router_env: HashMap<String, String>) -> impl Fn(&str) -> Option<String> {
    move |router_id: &str| {
        let var = router_env.get(router_id)?;
        std::env::var(var).ok().filter(|v| !v.is_empty())
    }
}
