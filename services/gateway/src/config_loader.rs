//! Load [`GatewayConfig`] from the Postgres config tables.
//!
//! The torii schema stores routing configuration in `catalog.routers`,
//! `catalog.models`, `catalog.model_capabilities`, `catalog.model_endpoints`,
//! and `public.fallback_chains` / `public.fallback_chain_models` (tenant-scoped
//! to the platform tenant: `core.tenants WHERE is_platform = true`).
//!
//! DB→config mapping lives in **pure builder functions** (no I/O) so they can
//! be unit-tested without a database. The async [`load_gateway_config`]
//! orchestrates the four SQL queries and feeds the rows to those builders.
//!
//! ### Capability mapping
//!
//! DB capability names (`chat`, `embedding`, `image`, `vision`, `audio`,
//! `agent`, `video`) map to the gateway [`Capability`] enum. `agent` collapses
//! to `TextChat` — agents are text-in/text-out at the routing level.

use std::collections::HashMap;

use anyhow::Context;
use gateway::types::capability::Capability;
use gateway::types::config::{
    ChainEntry, FallbackChainConfig, FallbackTrigger, GatewayConfig, ModelConfig, ModelPricing,
    RouterConfig,
};
use sqlx::Row;

// ─── Capability mapping ───────────────────────────────────────────────────────

/// Map a DB `catalog.capability_types.name` value to a gateway [`Capability`].
///
/// DB values: `chat`, `embedding`, `image`, `vision`, `audio`, `agent`, `video`.
/// Returns `None` for unrecognised values so callers can skip them gracefully.
pub(crate) fn map_capability(db_cap: &str) -> Option<Capability> {
    match db_cap {
        "chat" | "agent" => Some(Capability::TextChat),
        "embedding" => Some(Capability::TextEmbed),
        "image" => Some(Capability::ImageGenerate),
        "vision" => Some(Capability::ImageAnalyze),
        "audio" => Some(Capability::AudioTranscribe),
        "video" => Some(Capability::VideoGenerate),
        _ => None,
    }
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/// Parse a JSON text blob (`default_headers` jsonb) into a string→string map.
/// Non-object shapes and non-string values are silently ignored.
pub(crate) fn parse_headers(json_text: &str) -> HashMap<String, String> {
    serde_json::from_str::<serde_json::Value>(json_text)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .map(|obj| {
            obj.into_iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// Conservative default fallback triggers for every loaded chain.
/// The DB schema stores `max_fallback_attempts` but not per-chain triggers, so
/// every chain gets this set — conditions under which trying the next entry is
/// always safe (no partial-write risk).
fn default_triggers() -> Vec<FallbackTrigger> {
    vec![
        FallbackTrigger::RateLimit,
        FallbackTrigger::Timeout,
        FallbackTrigger::ProviderError,
    ]
}

// ─── Plain row structs (no I/O, unit-testable) ────────────────────────────────

#[derive(Debug, Clone)]
pub(crate) struct RouterRow {
    pub name: String,
    pub api_base_url: Option<String>,
    pub api_key_env_var: Option<String>,
    pub is_active: bool,
    /// Parsed text of the `default_headers` jsonb column.
    pub default_headers_json: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ModelRow {
    pub full_name: String,
    /// DB `catalog.capability_types.name` values aggregated from `model_capabilities`.
    pub capabilities: Vec<String>,
    pub context_window: Option<i32>,
    pub max_output_tokens: Option<i32>,
    /// Primary router name (is_default first, then lowest priority).
    pub default_router: String,
    /// `router_model_id` from the primary `model_endpoints` row.
    pub default_router_model_id: Option<String>,
    /// `cost_per_input_token * 1000` — cost per 1 k input tokens.
    pub cost_input_per_1k: f64,
    /// `cost_per_output_token * 1000` — cost per 1 k output tokens.
    pub cost_output_per_1k: f64,
    /// Per-request cost (nullable in the DB).
    pub cost_per_request: Option<f64>,
}

#[derive(Debug, Clone)]
pub(crate) struct ChainRow {
    pub name: String,
    /// DB `catalog.capability_types.name` value resolved from the FK.
    pub capability_name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ChainModelRow {
    pub chain_name: String,
    pub router_name: String,
    pub model_full_name: String,
    /// `router_model_id` from the matching `model_endpoints` row (if any).
    pub router_model_id: Option<String>,
    pub sequence_order: i32,
}

// ─── Pure builder functions ───────────────────────────────────────────────────

/// Build the `routers` map from `catalog.routers` rows.
pub(crate) fn build_routers(rows: &[RouterRow]) -> HashMap<String, RouterConfig> {
    rows.iter()
        .map(|r| {
            (
                r.name.clone(),
                RouterConfig {
                    url: r.api_base_url.clone().unwrap_or_default(),
                    api_key_env: r.api_key_env_var.clone(),
                    // Literal key is resolved from secrets at request time (Task 5).
                    api_key: None,
                    enabled: r.is_active,
                    // catalog.routers has no config jsonb; timeout deferred to Task 5.
                    timeout_ms: None,
                    headers: parse_headers(&r.default_headers_json),
                },
            )
        })
        .collect()
}

/// Build the `models` map from `catalog.models` rows (+ primary endpoint).
///
/// Models with no DB capability that maps to a gateway [`Capability`] are
/// skipped — they could never be selected by the engine anyway.
/// One [`ModelConfig`] is produced per model, keyed by `full_name`. The
/// `provider` field carries the primary router (is_default first). Chain
/// entries carry their own `router` override for the actual dispatch router.
pub(crate) fn build_models(rows: &[ModelRow]) -> HashMap<String, ModelConfig> {
    let mut models = HashMap::new();
    for m in rows {
        let mut capabilities: Vec<Capability> = Vec::new();
        for cap_name in &m.capabilities {
            if let Some(cap) = map_capability(cap_name) {
                if !capabilities.contains(&cap) {
                    capabilities.push(cap);
                }
            }
        }
        if capabilities.is_empty() {
            continue;
        }
        models.insert(
            m.full_name.clone(),
            ModelConfig {
                id: m.full_name.clone(),
                api_model_id: m
                    .default_router_model_id
                    .clone()
                    .or_else(|| Some(m.full_name.clone())),
                provider: m.default_router.clone(),
                capabilities,
                context_window: m.context_window.unwrap_or(0).max(0) as u32,
                max_output_tokens: m.max_output_tokens.unwrap_or(0).max(0) as u32,
                pricing: Some(ModelPricing {
                    input_per_1k: m.cost_input_per_1k,
                    output_per_1k: m.cost_output_per_1k,
                    per_request: m.cost_per_request,
                }),
                // MIG-2 (v0.4.6): model lineage for panel `distinct_by: family`.
                // None ⇒ the model id is its own family (fine until panels are used).
                family: None,
            },
        );
    }
    models
}

/// Build the `chains` map from `public.fallback_chains` + `fallback_chain_models`.
///
/// Chains whose DB capability name doesn't map to a gateway [`Capability`] are
/// skipped. Chains with no active members are also skipped. Entries are sorted
/// by `sequence_order` (ascending) to ensure the intended fallback order.
pub(crate) fn build_chains(
    chains: &[ChainRow],
    chain_models: &[ChainModelRow],
) -> HashMap<String, FallbackChainConfig> {
    let mut out = HashMap::new();
    for c in chains {
        let Some(capability) = map_capability(&c.capability_name) else {
            tracing::warn!(
                "config_loader: capability '{}' for chain '{}' has no gateway mapping, skipping",
                c.capability_name,
                c.name
            );
            continue;
        };
        let mut entries: Vec<ChainEntry> = chain_models
            .iter()
            .filter(|cm| cm.chain_name == c.name)
            .map(|cm| ChainEntry {
                model: cm.model_full_name.clone(),
                router: Some(cm.router_name.clone()),
                api_model_id: cm.router_model_id.clone(),
                priority: cm.sequence_order.clamp(0, u8::MAX as i32) as u8,
            })
            .collect();
        if entries.is_empty() {
            tracing::warn!(
                "config_loader: chain '{}' has no active members, skipping",
                c.name
            );
            continue;
        }
        entries.sort_by_key(|e| e.priority);
        out.insert(
            c.name.clone(),
            FallbackChainConfig {
                id: c.name.clone(),
                capability,
                models: entries,
                fallback_triggers: default_triggers(),
            },
        );
    }
    out
}

// ─── Async loader ─────────────────────────────────────────────────────────────

/// Load the full [`GatewayConfig`] from the Postgres config tables.
///
/// Reads:
/// - `catalog.routers` (active only)
/// - `catalog.models` joined to `model_capabilities` + primary `model_endpoints`
/// - `public.fallback_chains` + `fallback_chain_models` for the platform tenant
///
/// Uses runtime `sqlx::query` (no compile-time `query!` macro). After loading,
/// logs `"config: N routers, M models, K chains"`.
pub async fn load_gateway_config(pool: &sqlx::PgPool) -> anyhow::Result<GatewayConfig> {
    // ── Routers ───────────────────────────────────────────────────────────────
    let router_pg_rows = sqlx::query(
        "SELECT name,
                api_base_url,
                api_key_env_var,
                is_active,
                COALESCE(default_headers::text, 'null') AS default_headers
         FROM catalog.routers
         WHERE is_active = true",
    )
    .fetch_all(pool)
    .await
    .context("config_loader: routers query failed")?;

    let router_rows: Vec<RouterRow> = router_pg_rows
        .iter()
        .map(|row| RouterRow {
            name: row.get("name"),
            api_base_url: row.get("api_base_url"),
            api_key_env_var: row.get("api_key_env_var"),
            is_active: row.get("is_active"),
            default_headers_json: row.get("default_headers"),
        })
        .collect();

    // ── Models + primary endpoint ─────────────────────────────────────────────
    // JOIN LATERAL (not LEFT JOIN) ensures only models with at least one active
    // endpoint are included. Capabilities are aggregated via a subquery that
    // returns a text[] (empty array when no capabilities, never NULL).
    // Decimal pricing is cast to float8 for direct Rust f64 decoding.
    let model_pg_rows = sqlx::query(
        "SELECT m.full_name,
                ARRAY(
                    SELECT DISTINCT c.name
                    FROM catalog.model_capabilities mc
                    JOIN catalog.capability_types c ON c.id = mc.capability_id
                    WHERE mc.model_id = m.id AND mc.supported = true
                )::text[] AS capabilities,
                m.context_window,
                m.max_output_tokens,
                pe.router_name,
                pe.router_model_id,
                (pe.cost_per_input_token * 1000.0)::double precision AS cost_input_per_1k,
                (pe.cost_per_output_token * 1000.0)::double precision AS cost_output_per_1k,
                pe.cost_per_request::double precision AS cost_per_request
         FROM catalog.models m
         JOIN LATERAL (
             SELECT r.name              AS router_name,
                    me.router_model_id,
                    me.cost_per_input_token,
                    me.cost_per_output_token,
                    me.cost_per_request
             FROM catalog.model_endpoints me
             JOIN catalog.routers r ON r.id = me.router_id
             WHERE me.model_id = m.id AND me.is_active = true
             ORDER BY me.is_default DESC, me.priority ASC
             LIMIT 1
         ) pe ON true
         WHERE m.deprecated_on IS NULL",
    )
    .fetch_all(pool)
    .await
    .context("config_loader: models query failed")?;

    let model_rows: Vec<ModelRow> = model_pg_rows
        .iter()
        .map(|row| ModelRow {
            full_name: row.get("full_name"),
            capabilities: row.get("capabilities"),
            context_window: row.get("context_window"),
            max_output_tokens: row.get("max_output_tokens"),
            default_router: row.get("router_name"),
            default_router_model_id: row.get("router_model_id"),
            cost_input_per_1k: row.get("cost_input_per_1k"),
            cost_output_per_1k: row.get("cost_output_per_1k"),
            cost_per_request: row.get("cost_per_request"),
        })
        .collect();

    // ── Fallback chains (platform tenant) ────────────────────────────────────
    // Chains are tenant-scoped; the platform tenant (is_platform = true) holds
    // the seed/default chains consumed by the gateway engine.
    let chain_pg_rows = sqlx::query(
        "SELECT fc.name, cap.name AS capability_name
         FROM public.fallback_chains fc
         JOIN catalog.capability_types cap ON cap.id = fc.capability_id
         WHERE fc.tenant_id = (
                   SELECT id FROM core.tenants WHERE is_platform = true LIMIT 1
               )
           AND fc.is_active = true",
    )
    .fetch_all(pool)
    .await
    .context("config_loader: fallback_chains query failed")?;

    let chain_rows: Vec<ChainRow> = chain_pg_rows
        .iter()
        .map(|row| ChainRow {
            name: row.get("name"),
            capability_name: row.get("capability_name"),
        })
        .collect();

    // ── Chain models ──────────────────────────────────────────────────────────
    // LEFT JOIN LATERAL to model_endpoints retrieves the router-specific model
    // id (router_model_id) for the (model, router) pair in this chain step.
    // If no matching endpoint row exists, router_model_id is NULL (→ None).
    let chain_model_pg_rows = sqlx::query(
        "SELECT fc.name         AS chain_name,
                r.name          AS router_name,
                m.full_name     AS model_full_name,
                me.router_model_id,
                fcm.sequence_order
         FROM public.fallback_chain_models fcm
         JOIN public.fallback_chains fc
              ON fc.tenant_id = fcm.tenant_id AND fc.id = fcm.fallback_chain_id
         JOIN catalog.routers r ON r.id = fcm.router_id
         JOIN catalog.models  m ON m.id = fcm.model_id
         LEFT JOIN LATERAL (
             SELECT me2.router_model_id
             FROM catalog.model_endpoints me2
             WHERE me2.model_id  = fcm.model_id
               AND me2.router_id = fcm.router_id
               AND me2.is_active = true
             ORDER BY me2.is_default DESC, me2.priority ASC
             LIMIT 1
         ) me ON true
         WHERE fcm.tenant_id = (
                   SELECT id FROM core.tenants WHERE is_platform = true LIMIT 1
               )
           AND fcm.is_active = true
           AND fc.is_active  = true
         ORDER BY fc.name, fcm.sequence_order",
    )
    .fetch_all(pool)
    .await
    .context("config_loader: fallback_chain_models query failed")?;

    let chain_model_rows: Vec<ChainModelRow> = chain_model_pg_rows
        .iter()
        .map(|row| ChainModelRow {
            chain_name: row.get("chain_name"),
            router_name: row.get("router_name"),
            model_full_name: row.get("model_full_name"),
            router_model_id: row.get("router_model_id"),
            sequence_order: row.get("sequence_order"),
        })
        .collect();

    // ── Assemble ──────────────────────────────────────────────────────────────
    let routers = build_routers(&router_rows);
    let models = build_models(&model_rows);
    let chains = build_chains(&chain_rows, &chain_model_rows);

    tracing::info!(
        "config: {} routers, {} models, {} chains",
        routers.len(),
        models.len(),
        chains.len()
    );

    Ok(GatewayConfig {
        routers,
        models,
        chains,
        // MIG-2 (v0.4.6): new config surfaces — AUTH constraints, fan-out panels,
        // consensus workflows. Defaults are empty ⇒ no enforcement / none defined
        // (Torii drives budgets via C3's hard reserve, not the crate quota).
        constraints: Default::default(),
        panels: Default::default(),
        consensus: Default::default(),
    })
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use gateway::types::capability::Capability;

    // ── map_capability ────────────────────────────────────────────────────────

    #[test]
    fn map_capability_covers_all_db_values() {
        assert_eq!(map_capability("chat"), Some(Capability::TextChat));
        assert_eq!(map_capability("agent"), Some(Capability::TextChat));
        assert_eq!(map_capability("embedding"), Some(Capability::TextEmbed));
        assert_eq!(map_capability("image"), Some(Capability::ImageGenerate));
        assert_eq!(map_capability("vision"), Some(Capability::ImageAnalyze));
        assert_eq!(map_capability("audio"), Some(Capability::AudioTranscribe));
        assert_eq!(map_capability("video"), Some(Capability::VideoGenerate));
        assert_eq!(map_capability("unknown"), None);
        assert_eq!(map_capability(""), None);
    }

    // ── parse_headers ─────────────────────────────────────────────────────────

    #[test]
    fn parse_headers_keeps_string_values_only() {
        let h = parse_headers(r#"{"Content-Type":"application/json","n":5}"#);
        assert_eq!(
            h.get("Content-Type").map(String::as_str),
            Some("application/json")
        );
        assert!(!h.contains_key("n")); // non-string skipped
    }

    #[test]
    fn parse_headers_handles_null_and_invalid_json() {
        assert!(parse_headers("null").is_empty());
        assert!(parse_headers("not-json").is_empty());
        assert!(parse_headers(r#""a string""#).is_empty());
    }

    // ── build_routers ─────────────────────────────────────────────────────────

    fn anthropic_router_row() -> RouterRow {
        RouterRow {
            name: "anthropic".to_string(),
            api_base_url: Some("https://api.anthropic.com/v1".to_string()),
            api_key_env_var: Some("ANTHROPIC_API_KEY".to_string()),
            is_active: true,
            default_headers_json: r#"{"anthropic-version":"2023-06-01"}"#.to_string(),
        }
    }

    #[test]
    fn build_routers_maps_all_fields() {
        let routers = build_routers(&[anthropic_router_row()]);
        let r = &routers["anthropic"];
        assert_eq!(r.url, "https://api.anthropic.com/v1");
        assert_eq!(r.api_key_env.as_deref(), Some("ANTHROPIC_API_KEY"));
        assert!(r.api_key.is_none());
        assert!(r.enabled);
        assert!(r.timeout_ms.is_none());
        assert_eq!(
            r.headers.get("anthropic-version").map(String::as_str),
            Some("2023-06-01")
        );
    }

    #[test]
    fn build_routers_handles_missing_url() {
        let row = RouterRow {
            name: "local".to_string(),
            api_base_url: None,
            api_key_env_var: None,
            is_active: true,
            default_headers_json: "null".to_string(),
        };
        let routers = build_routers(&[row]);
        assert_eq!(routers["local"].url, "");
        assert!(routers["local"].headers.is_empty());
    }

    // ── build_models ──────────────────────────────────────────────────────────

    fn claude_row() -> ModelRow {
        ModelRow {
            full_name: "claude-sonnet-4-5".to_string(),
            capabilities: vec!["chat".to_string(), "vision".to_string()],
            context_window: Some(200_000),
            max_output_tokens: Some(8192),
            default_router: "anthropic".to_string(),
            default_router_model_id: Some("claude-sonnet-4-5-20251022".to_string()),
            cost_input_per_1k: 3.0,
            cost_output_per_1k: 15.0,
            cost_per_request: None,
        }
    }

    #[test]
    fn build_models_maps_capabilities_and_pricing() {
        let models = build_models(&[claude_row()]);
        let m = &models["claude-sonnet-4-5"];
        assert_eq!(m.id, "claude-sonnet-4-5");
        assert_eq!(m.provider, "anthropic");
        assert_eq!(
            m.api_model_id.as_deref(),
            Some("claude-sonnet-4-5-20251022")
        );
        assert_eq!(m.context_window, 200_000);
        assert_eq!(m.max_output_tokens, 8192);
        assert!(m.capabilities.contains(&Capability::TextChat));
        assert!(m.capabilities.contains(&Capability::ImageAnalyze));
        let p = m.pricing.as_ref().unwrap();
        assert_eq!(p.input_per_1k, 3.0);
        assert_eq!(p.output_per_1k, 15.0);
        assert!(p.per_request.is_none());
    }

    #[test]
    fn build_models_deduplicates_capabilities() {
        let row = ModelRow {
            capabilities: vec![
                "chat".to_string(),
                "agent".to_string(), // also maps to TextChat → deduped
                "vision".to_string(),
            ],
            ..claude_row()
        };
        let models = build_models(&[row]);
        let caps = &models["claude-sonnet-4-5"].capabilities;
        // chat + agent both → TextChat; vision → ImageAnalyze: 2 unique caps
        assert_eq!(caps.len(), 2);
        assert!(caps.contains(&Capability::TextChat));
        assert!(caps.contains(&Capability::ImageAnalyze));
    }

    #[test]
    fn build_models_skips_unmappable_capabilities() {
        let row = ModelRow {
            capabilities: vec!["nonsense".to_string()],
            ..claude_row()
        };
        let models = build_models(&[row]);
        assert!(
            models.is_empty(),
            "model with no mappable capability is skipped"
        );
    }

    #[test]
    fn build_models_falls_back_to_full_name_for_api_model_id() {
        let row = ModelRow {
            full_name: "gpt-4o".to_string(),
            capabilities: vec!["chat".to_string()],
            context_window: Some(128_000),
            max_output_tokens: Some(4096),
            default_router: "openai".to_string(),
            default_router_model_id: None, // no router_model_id
            cost_input_per_1k: 2.5,
            cost_output_per_1k: 10.0,
            cost_per_request: None,
        };
        let models = build_models(&[row]);
        assert_eq!(models["gpt-4o"].api_model_id.as_deref(), Some("gpt-4o"));
    }

    // ── build_chains ──────────────────────────────────────────────────────────

    fn chat_chain_row() -> ChainRow {
        ChainRow {
            name: "chat".to_string(),
            capability_name: "chat".to_string(),
        }
    }

    fn sample_chain_models() -> Vec<ChainModelRow> {
        vec![
            ChainModelRow {
                chain_name: "chat".to_string(),
                router_name: "openai".to_string(),
                model_full_name: "gpt-4o".to_string(),
                router_model_id: Some("gpt-4o".to_string()),
                sequence_order: 2,
            },
            ChainModelRow {
                chain_name: "chat".to_string(),
                router_name: "anthropic".to_string(),
                model_full_name: "claude-sonnet-4-5".to_string(),
                router_model_id: Some("claude-sonnet-4-5-20251022".to_string()),
                sequence_order: 1,
            },
        ]
    }

    #[test]
    fn build_chains_orders_by_sequence_and_carries_router_model_id() {
        let chains = build_chains(&[chat_chain_row()], &sample_chain_models());
        let c = &chains["chat"];
        assert_eq!(c.id, "chat");
        assert_eq!(c.capability, Capability::TextChat);
        assert_eq!(c.models.len(), 2);
        // sequence 1 (anthropic) should come first after sort
        assert_eq!(c.models[0].model, "claude-sonnet-4-5");
        assert_eq!(c.models[0].router.as_deref(), Some("anthropic"));
        assert_eq!(
            c.models[0].api_model_id.as_deref(),
            Some("claude-sonnet-4-5-20251022")
        );
        assert_eq!(c.models[0].priority, 1);
        assert_eq!(c.models[1].model, "gpt-4o");
        assert_eq!(c.models[1].priority, 2);
        assert_eq!(c.fallback_triggers, default_triggers());
    }

    #[test]
    fn build_chains_skips_chain_with_unmappable_capability() {
        let bad_chain = ChainRow {
            name: "unknown-chain".to_string(),
            capability_name: "nonsense".to_string(),
        };
        let chains = build_chains(&[bad_chain], &sample_chain_models());
        assert!(
            chains.is_empty(),
            "chain with unmappable capability is skipped"
        );
    }

    #[test]
    fn build_chains_skips_chain_with_no_members() {
        let chains = build_chains(
            &[chat_chain_row()],
            &[], // no members
        );
        assert!(chains.is_empty(), "chain with no members is skipped");
    }

    #[test]
    fn build_chains_handles_multiple_chains() {
        let fast_chain = ChainRow {
            name: "fast".to_string(),
            capability_name: "chat".to_string(),
        };
        let fast_members = vec![ChainModelRow {
            chain_name: "fast".to_string(),
            router_name: "openai".to_string(),
            model_full_name: "gpt-4o-mini".to_string(),
            router_model_id: None,
            sequence_order: 1,
        }];
        let mut all_members = sample_chain_models();
        all_members.extend(fast_members);

        let chains = build_chains(&[chat_chain_row(), fast_chain], &all_members);
        assert_eq!(chains.len(), 2);
        assert!(chains.contains_key("chat"));
        assert!(chains.contains_key("fast"));
    }
}
