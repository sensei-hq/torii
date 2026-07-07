//! In-process inference engine for the Strategos desktop app — the **local
//! plane** (Phase 1b).
//!
//! This builds an `Arc<gateway::Gateway>` that runs entirely inside the Tauri
//! process: no daemon, no HTTP hop. A single `embedded-llama` adapter
//! (llama.cpp via `gateway-embedded`) serves chat locally, with the model
//! bytes resolved through a two-stage registry — Strategos-managed files first
//! (`~/.strategos/models`), then a read-through view of the local Ollama cache
//! (`~/.ollama/models`). A model already pulled by Ollama (e.g. `gemma2:2b`) is
//! reused in place; nothing has to ship with the binary. The per-model worker
//! loads lazily on first inference.
//!
//! This mirrors Sensei's engine construction
//! (`crates/senseid/src/api/gateway_init.rs` + `gateway_embedded.rs`), trimmed
//! to the single local adapter the desktop needs today.
//!
//! The cloud / split-plane routing (external providers, table-driven config,
//! Keychain-resolved keys) is **Phase 2** and is intentionally absent here.

use std::path::PathBuf;
use std::sync::Arc;

use gateway::adapters::noop::NoopAdapter;
use gateway::adapters::{AdapterRegistry, InferenceAdapter};
use gateway::circuit_breaker::{CircuitBreakerConfig, CircuitBreakerManager};
use gateway::types::capability::Capability;
use gateway::types::config::{
    ChainEntry, FallbackChainConfig, FallbackTrigger, GatewayConfig, ModelConfig, RouterConfig,
};
use gateway::Gateway;

/// Build the in-process gateway: register the fallback + embedded-llama
/// adapters and wire the baseline local-chat config, returning a shared handle
/// ready for Tauri's managed state.
///
/// Async because adapter registration and llama.cpp backend init happen on the
/// async registry API. Never fails — if the llama.cpp backend can't initialise,
/// the `embedded-llama` adapter is simply skipped (logged) and the gateway
/// still returns with the noop fallback registered.
pub async fn build_gateway() -> Arc<Gateway> {
    let adapters = AdapterRegistry::new();

    // Always register noop as a graceful-degradation fallback so the registry
    // is never empty even if the native backend is unavailable.
    adapters
        .register(Arc::new(NoopAdapter) as Arc<dyn InferenceAdapter>)
        .await;

    register_embedded_llama(&adapters).await;

    let config = baseline_local_config();
    let cb = CircuitBreakerManager::new(CircuitBreakerConfig::default());
    Arc::new(Gateway::new(config, adapters, cb))
}

/// Register the in-process llama.cpp adapter under the id `embedded-llama`,
/// backed by the process-wide shared llama backend and a Managed → Ollama
/// resolver chain (first hit wins).
async fn register_embedded_llama(adapters: &AdapterRegistry) {
    use gateway_embedded::adapters::EmbeddedLlamaAdapter;
    use gateway_embedded::registry::{ChainedResolver, ManagedResolver, OllamaResolver};

    let resolver = ChainedResolver::new()
        .push(Arc::new(ManagedResolver::new(strategos_models_dir())))
        .push(Arc::new(OllamaResolver::new(ollama_models_dir())));

    match EmbeddedLlamaAdapter::with_shared_backend("embedded-llama", Arc::new(resolver)) {
        Ok(adapter) => {
            adapters
                .register(Arc::new(adapter) as Arc<dyn InferenceAdapter>)
                .await;
            log::info!(
                "gateway: embedded-llama adapter registered (resolver: managed -> ollama)"
            );
        }
        Err(e) => log::warn!("gateway: embedded-llama adapter unavailable: {e}"),
    }
}

/// The user's home directory. Falls back to the current dir if `HOME` is unset
/// (never expected on macOS/Linux desktop; keeps this infallible).
fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Strategos-managed model directory (`~/.strategos/models`), created if
/// missing. First leg of the resolver chain.
fn strategos_models_dir() -> PathBuf {
    let dir = home_dir().join(".strategos").join("models");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!("gateway: could not create {}: {e}", dir.display());
    }
    dir
}

/// Local Ollama cache root (`~/.ollama/models`). Read-through only — the Ollama
/// daemon owns these bytes. Second leg of the resolver chain.
fn ollama_models_dir() -> PathBuf {
    home_dir().join(".ollama").join("models")
}

/// Baseline local config: one `embedded-llama` router, one `gemma2:2b` chat
/// model wired to it, and a `local-chat` fallback chain for `TextChat`.
///
/// The `embedded-llama` [`RouterConfig`] entry is load-bearing, not decorative:
/// the engine's config validation requires every model's `provider` to have a
/// matching router (`GatewayBuilder::validate` Rule 4 —
/// `if !self.routers.contains_key(&model.provider)`), and the chain's
/// direct/tier-1 dispatch looks the adapter up by the [`ChainEntry::router`]
/// id. Both must equal the adapter id `"embedded-llama"`.
fn baseline_local_config() -> GatewayConfig {
    use std::collections::HashMap;

    let mut routers: HashMap<String, RouterConfig> = HashMap::new();
    routers.insert(
        "embedded-llama".into(),
        RouterConfig {
            // In-process pseudo-URL; there's no network endpoint. Non-empty so
            // config validation (which rejects empty router URLs) is satisfied.
            url: "embedded://embedded-llama".into(),
            api_key_env: None,
            api_key: None,
            enabled: true,
            timeout_ms: Some(120_000),
            headers: HashMap::new(),
        },
    );

    let mut models: HashMap<String, ModelConfig> = HashMap::new();
    models.insert(
        "gemma2:2b".into(),
        ModelConfig {
            id: "gemma2:2b".into(),
            // The id the resolver keys on when locating the GGUF bytes in the
            // managed dir / Ollama cache.
            api_model_id: Some("gemma2:2b".into()),
            provider: "embedded-llama".into(),
            capabilities: vec![Capability::TextChat],
            context_window: 8_192,
            max_output_tokens: 1_024,
            pricing: None,
        },
    );

    let mut chains: HashMap<String, FallbackChainConfig> = HashMap::new();
    chains.insert(
        "local-chat".into(),
        FallbackChainConfig {
            id: "local-chat".into(),
            capability: Capability::TextChat,
            models: vec![ChainEntry {
                model: "gemma2:2b".into(),
                router: Some("embedded-llama".into()),
                api_model_id: None,
                priority: 1,
            }],
            fallback_triggers: vec![
                FallbackTrigger::RateLimit,
                FallbackTrigger::Timeout,
                FallbackTrigger::ProviderError,
            ],
        },
    );

    GatewayConfig {
        routers,
        models,
        chains,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construction smoke test: the gateway builds and the `embedded-llama`
    /// adapter lands in the registry. Does NOT run inference. Requires the
    /// llama.cpp backend to initialise (the toolchain is present on the dev
    /// machine); a failed backend init would skip registration and fail here.
    #[tokio::test]
    async fn builds_and_registers_embedded_adapter() {
        let gw = build_gateway().await;
        let adapters = gw.list_adapters().await;
        assert!(
            adapters.iter().any(|a| a == "embedded-llama"),
            "expected 'embedded-llama' in registered adapters: {adapters:?}"
        );
    }
}
