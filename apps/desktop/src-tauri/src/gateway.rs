//! In-process inference engine for the Torii desktop app — the **local
//! plane** (Phase 1b).
//!
//! This builds an `Arc<gateway::Gateway>` that runs entirely inside the Tauri
//! process: no daemon, no HTTP hop. A single `embedded-llama` adapter
//! (in-process llama.cpp via `sensei-local-providers::EmbeddedLlamaAdapter`,
//! re-exported as `gateway::local::EmbeddedLlamaAdapter`) serves chat locally, with the model
//! bytes resolved through a two-stage registry — managed files first
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

// MIG-3 (v0.4.6): the local wing is `sensei-local-*`, re-exported under
// `gateway::local::*` when the `gateway` dep enables `local-llama-cpp`. The
// deleted `InferenceAdapter` trait → capability traits + `RegisterInto`
// (registry dispatches via `RegisterInto`; no `dyn InferenceAdapter` cast).
use gateway::adapters::noop::NoopAdapter;
use gateway::adapters::AdapterRegistry;
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
        .register(Arc::new(NoopAdapter))
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
    use gateway::local::{ChainedResolver, EmbeddedLlamaAdapter, ManagedResolver, OllamaResolver};

    let resolver = ChainedResolver::new()
        .push(Arc::new(ManagedResolver::new(managed_models_dir())))
        .push(Arc::new(OllamaResolver::new(ollama_models_dir())));

    match EmbeddedLlamaAdapter::with_shared_backend("embedded-llama", Arc::new(resolver)) {
        Ok(adapter) => {
            adapters
                .register(Arc::new(adapter))
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

/// Torii's managed model directory. Path stays `~/.strategos/models` for now —
/// the on-disk identity (this dir, `local.db`, the `strategos://` deep-link
/// scheme, the Tauri bundle id) renames together in the deferred T3 sweep so a
/// piecemeal change can't orphan a user's pulled models. Created if missing;
/// first leg of the resolver chain.
fn managed_models_dir() -> PathBuf {
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
            family: None, // MIG-3 (v0.4.6): panel distinctness lineage; None ⇒ id-is-family
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
        // MIG-3 (v0.4.6): AUTH constraints / fan-out panels / consensus workflows —
        // none used on the local plane. Empty defaults ⇒ no enforcement / undefined.
        constraints: Default::default(),
        panels: Default::default(),
        consensus: Default::default(),
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
