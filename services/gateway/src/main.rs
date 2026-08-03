use std::sync::Arc;

use axum::http::{
    header::{HeaderName, ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    Method,
};
use axum::{
    middleware,
    routing::{get, post},
    Router,
};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

// MIG-2 (v0.4.6): `InferenceAdapter` was deleted — adapters now impl the
// capability-segregated traits (ChatModel/EmbedModel/…) + `RegisterInto`, and
// `AdapterRegistry::register(Arc::new(adapter))` dispatches via `RegisterInto`
// (no `dyn InferenceAdapter` cast). Cloud adapters are re-exported under the
// historical `gateway::adapters::<provider>` paths (feature `cloud`, default-on).
use gateway::adapters::noop::NoopAdapter;
use gateway::adapters::AdapterRegistry;
use gateway::circuit_breaker::{CircuitBreakerConfig, CircuitBreakerManager};
use gateway::Gateway;

mod analytics; // O2: analytics query builders (group_by → denormalized column; window/bucket)
mod apikeys; // H2: API-key generation + argon2 hash/verify (identity-bound)
mod auth;
mod budgets; // C3: budget-node resolution + hard reserve→commit on the inference hot path
mod capabilities; // F2: server-side capability resolution + claims-version gate
mod config_loader;
mod governance; // C4: output redaction + injection scan + why-this-model governance
mod judge; // C6: opt-in LLM-as-judge (local gemma4) → judge_score signal
mod keys;
mod provision; // DB auto-provision (dbd deploy) on startup — fetch schema ref → apply/import/policies
mod quality; // C6: quality-signal capture (one implicit batch per inference call)
mod rag; // C5: RAG ingestion pipeline + hybrid retrieval (docs/plans/C5-rag-backend-build-plan.md)
mod redact; // C4: secret/PII redaction (DLP, §2 W5)
mod routes;
mod siem; // O1: background audit → SIEM streamer (per-tenant cursor, at-least-once)
mod state;
mod store;

use state::{AppState, SharedState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "torii_gateway=info,tower_http=info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".to_string());

    let supabase_url = std::env::var("PUBLIC_SUPABASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:55321".to_string());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8787);

    // Bind host: 127.0.0.1 for local dev (not externally exposed); set HOST=0.0.0.0 in a
    // container (Fly/Docker) so the platform's proxy can reach it.
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    // Connect Postgres pool
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    tracing::info!("Database connected");

    // DB auto-provision (dbd deploy): if TORII_DB_SCHEMA_SOURCE is set and the catalog is absent,
    // fetch the schema from that GitHub ref and apply + import + RLS policies BEFORE the config
    // loader queries it — so a fresh prod Supabase becomes usable on first boot instead of
    // crash-looping. No-op when unset (dev / pre-provisioned); advisory-locked; fail-closed.
    provision::maybe_provision(&pool, &database_url).await?;

    // Fetch JWKS from Supabase at startup.
    // Degrades gracefully — an empty JWKS means auth will fail fast with 401
    // until Supabase comes up and the middleware refetches on the first kid miss.
    let jwks = auth::fetch_jwks(&supabase_url).await;

    // Build the gateway adapter registry
    let adapters = AdapterRegistry::new();

    // Always register noop as graceful degradation fallback
    adapters.register(Arc::new(NoopAdapter)).await;

    // Probe Ollama at localhost:11434 before registering
    if probe_ollama().await {
        match gateway::adapters::ollama::OllamaAdapter::new() {
            Ok(adapter) => {
                tracing::info!("Gateway: Ollama adapter registered");
                adapters.register(Arc::new(adapter)).await;
            }
            Err(e) => tracing::warn!("Gateway: Ollama adapter failed to initialize: {}", e),
        }
    } else {
        tracing::info!("Gateway: Ollama not available, skipping");
    }

    // Cloud adapters — registered unconditionally; key resolution happens at
    // request time via RouterConfig.api_key / api_key_env (Task 5 wires these).
    match gateway::adapters::anthropic::AnthropicAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: Anthropic adapter registered");
            adapters.register(Arc::new(adapter)).await;
        }
        Err(e) => tracing::warn!("Gateway: Anthropic adapter failed: {}", e),
    }

    match gateway::adapters::openai::OpenAIAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: OpenAI adapter registered");
            adapters.register(Arc::new(adapter)).await;
        }
        Err(e) => tracing::warn!("Gateway: OpenAI adapter failed: {}", e),
    }

    // OpenAI-compatible aggregators/gateways (same wire format, distinct router id)
    for id in ["openrouter", "vercel", "nvidia"] {
        match gateway::adapters::openai::OpenAIAdapter::with_id(id) {
            Ok(adapter) => {
                tracing::info!("Gateway: OpenAI-compatible adapter registered as '{id}'");
                adapters.register(Arc::new(adapter)).await;
            }
            Err(e) => tracing::warn!("Gateway: '{id}' adapter failed: {e}"),
        }
    }

    match gateway::adapters::grok::GrokAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: Grok adapter registered");
            adapters.register(Arc::new(adapter)).await;
        }
        Err(e) => tracing::warn!("Gateway: Grok adapter failed: {}", e),
    }

    match gateway::adapters::gemini::GeminiAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: Gemini adapter registered");
            adapters.register(Arc::new(adapter)).await;
        }
        Err(e) => tracing::warn!("Gateway: Gemini adapter failed: {}", e),
    }

    // Bedrock uses the AWS SDK credential-provider chain; constructs without
    // needing credentials present — fails at request time if credentials are absent.
    match gateway::adapters::bedrock::BedrockAdapter::new().await {
        Ok(adapter) => {
            tracing::info!("Gateway: Bedrock adapter registered");
            adapters.register(Arc::new(adapter)).await;
        }
        Err(e) => tracing::warn!("Gateway: Bedrock adapter failed: {}", e),
    }

    // Load the real GatewayConfig from the Postgres config tables (Task 4).
    // Reads config.routers, config.models, and public.fallback_chains for the
    // platform tenant; logs router/model/chain counts on success.
    let config = config_loader::load_gateway_config(&pool).await?;

    // Build the router_id → env_var_name map before Gateway::new moves config.
    let router_env = keys::router_env_map(&config);

    let cb = CircuitBreakerManager::new(CircuitBreakerConfig::default());
    // One `Arc<Gateway>` built up front: it backs both `AppState.gateway` and the C5
    // `EngineEmbedder` (config-driven embedding runs through the SAME engine).
    let gateway = Arc::new(Gateway::new(config, adapters, cb));

    // Inject provider (BYOK) keys from the process environment (Task 5).
    // F3 vault decryption is deferred; keys resolve via std::env::var.
    gateway
        .refresh_router_keys(keys::env_key_resolver(router_env.clone()))
        .await;
    let resolved = router_env
        .values()
        .filter(|v| std::env::var(v).is_ok())
        .count();
    let total = router_env.len();
    tracing::info!(
        "keys: {}/{} routers have a provider key in env",
        resolved,
        total
    );

    // F3 BYOK: build the per-tenant credential cache from the env KEK. An absent/invalid KEK
    // ⇒ BYOK disabled (env/platform keys still serve) — the gateway still starts.
    let tenant_keys = crate::state::build_tenant_key_cache(pool.clone()).await;

    // C5 RAG wiring — config-driven, no-hardcoded-ops (chain / model / bucket from env):
    //   embedder  → the sensei engine over a named embedding chain (mock↔prod seam),
    //   store     → Supabase Storage (originals + derived artifacts, signed URLs),
    //   ingestor  → parse → redact-at-rest → chunk → embed → index (spawned per ingest request),
    //   retriever → hybrid_search (dense pgvector + BM25 fused by RRF, isolation in-query).
    let embed_chain = std::env::var("TORII_EMBED_CHAIN").unwrap_or_else(|_| "embedding".into());
    let embedder: Arc<dyn crate::rag::embed::Embedder> = Arc::new(
        crate::rag::embed::EngineEmbedder::new(gateway.clone(), embed_chain),
    );
    let object_store: Arc<dyn crate::rag::storage::ObjectStore> =
        Arc::new(crate::rag::storage::SupabaseStorage::from_env());
    let embed_model =
        std::env::var("TORII_EMBED_MODEL").unwrap_or_else(|_| "mxbai-embed-large".into());
    let ingestor = Arc::new(crate::rag::ingest::Ingestor {
        pool: pool.clone(),
        store: crate::rag::store::DocStore::new(pool.clone()),
        storage: object_store.clone(),
        parser: Arc::new(crate::rag::parse::DefaultParser),
        chunker: Arc::new(crate::rag::chunk::StructuralChunker),
        embedder: embedder.clone(),
        redactor: crate::redact::Redactor,
        embed_model,
    });
    let retriever: Arc<dyn crate::rag::retrieve::RetrievalEngine> = Arc::new(
        crate::rag::retrieve::HybridRetriever::new(pool.clone(), embedder.clone()),
    );

    let state: SharedState = Arc::new(AppState {
        pool,
        gateway,
        jwks: RwLock::new(jwks),
        tenant_keys,
        embedder,
        object_store,
        ingestor,
        retriever,
    });

    // O1: background audit → SIEM streamer (no-op until a `siem` notification_channel exists).
    siem::spawn(Arc::clone(&state));

    // CORS: explicit method + header lists — wildcard is rejected by WKWebView/Safari
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            CONTENT_TYPE,
            ACCEPT,
            AUTHORIZATION,
            HeaderName::from_static("x-torii-device"),
        ]);

    // `/v1` routes — all require a valid Supabase JWT.
    // Routes added BEFORE route_layer inherit the auth middleware.
    let v1 = Router::new()
        .route("/whoami", get(routes::whoami::whoami))
        .route("/chat", post(routes::chat::post_chat))
        .route("/chat/stream", post(routes::chat::post_chat_stream))
        .route("/judge", post(routes::judge::post_judge))
        .route("/status", get(routes::status::get_status))
        .route("/audit", get(routes::ledger::get_audit))
        .route("/requests", get(routes::ledger::get_requests))
        .route(
            "/requests/{id}/trace",
            get(routes::ledger::get_request_trace),
        )
        .route("/budgets", get(routes::ledger::get_budgets))
        .route("/apikeys", get(routes::ledger::get_apikeys))
        .route("/connections", get(routes::ledger::get_connections))
        .route("/org", get(routes::ledger::get_org))
        .route("/models", get(routes::ledger::get_models))
        .route(
            "/models/available",
            get(routes::ledger::get_available_models),
        )
        .route("/tools", get(routes::ledger::get_tools))
        .route("/devices", get(routes::ledger::get_devices))
        .route("/routing", get(routes::ledger::get_routing))
        .route("/governance", get(routes::ledger::get_governance))
        .route("/settings", get(routes::ledger::get_settings))
        // O2 · analytics read model (P12): tenant-scoped dashboards over the one ledger.
        .route("/analytics/overview", get(routes::analytics::get_overview))
        .route("/analytics/cost-trend", get(routes::analytics::get_cost_trend))
        .route("/analytics/model-mix", get(routes::analytics::get_model_mix))
        .route("/analytics/plane-split", get(routes::analytics::get_plane_split))
        .route("/analytics/spend", get(routes::analytics::get_spend))
        .route("/analytics/quality", get(routes::analytics::get_quality))
        .route("/analytics/export", get(routes::analytics::get_export))
        // D4: versioned, credential-free config snapshot the desktop pulls to hot-reload.
        .route("/config/snapshot", get(routes::config::get_snapshot))
        // C5 · RAG document surface + hybrid retrieval (docs/plans/C5-rag-backend-build-plan.md).
        .route(
            "/documents",
            post(routes::documents::create_document).get(routes::documents::list_documents),
        )
        .route(
            "/documents/{id}",
            get(routes::documents::get_document).delete(routes::documents::delete_document),
        )
        .route(
            "/documents/{id}/ingest",
            post(routes::documents::ingest_document),
        )
        .route(
            "/documents/{id}/reingest",
            post(routes::documents::reingest_document),
        )
        .route(
            "/documents/{id}/assets",
            get(routes::documents::get_assets),
        )
        .route(
            "/spaces/{space_id}/retrieve",
            post(routes::retrieve::retrieve),
        )
        .route(
            "/spaces/{space_id}/retrieval-config",
            get(routes::retrieve::retrieval_config),
        )
        // C1/C4 · grounded Ask — list spaces + retrieval-augmented, cited generation.
        .route("/spaces", get(routes::ask::list_spaces))
        .route("/spaces/{space_id}/ask", post(routes::ask::ask))
        .route_layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            auth::require_auth,
        ));

    // `/rpc` — gateway-mediated privileged writes (DECISIONS §5a). Same auth
    // middleware as `/v1`; each handler additionally resolves capabilities +
    // runs the claims-version freshness gate server-side.
    let rpc = Router::new()
        .route(
            "/budgets/upsert-node",
            post(routes::rpc::budgets_upsert_node),
        )
        .route(
            "/budgets/delete-node",
            post(routes::rpc::budgets_delete_node),
        )
        .route("/budgets/request", post(routes::rpc::budgets_request))
        .route(
            "/budgets/approve-request",
            post(routes::rpc::budgets_approve_request),
        )
        .route(
            "/budgets/deny-request",
            post(routes::rpc::budgets_deny_request),
        )
        .route("/apikeys/issue", post(routes::rpc::apikeys_issue))
        .route("/apikeys/revoke", post(routes::rpc::apikeys_revoke))
        .route("/devices/revoke", post(routes::rpc::devices_revoke))
        .route("/rbac/assign-role", post(routes::rpc::rbac_assign_role))
        .route("/rbac/unassign-role", post(routes::rpc::rbac_unassign_role))
        .route("/rbac/create-role", post(routes::rpc::rbac_create_role))
        .route("/orgs/create", post(routes::rpc::orgs_create))
        .route(
            "/orgs/transfer-ownership",
            post(routes::rpc::orgs_transfer_ownership),
        )
        .route(
            "/governance/set-feature",
            post(routes::rpc::governance_set_feature),
        )
        .route(
            "/routing/set-step-active",
            post(routes::rpc::routing_set_step),
        )
        .route("/models/set-enabled", post(routes::rpc::models_set_enabled))
        .route("/settings/set", post(routes::rpc::settings_set))
        .route("/mcp/set-enabled", post(routes::rpc::mcp_set_enabled))
        .route("/mcp/set-tool-grant", post(routes::rpc::mcp_set_tool_grant))
        // X1 (P11): registry write handlers — register a server (+ discover) / refresh its tools.
        .route("/mcp/register-server", post(routes::mcp::register_server))
        .route("/mcp/refresh-tools", post(routes::mcp::refresh_tools))
        .route("/spaces/create", post(routes::rpc::spaces_create))
        .route(
            "/connections/connect",
            post(routes::rpc::connections_connect),
        )
        .route("/connections/rotate", post(routes::rpc::connections_rotate))
        .route("/connections/revoke", post(routes::rpc::connections_revoke))
        .route(
            "/connections/oauth-connect",
            post(routes::rpc::connections_oauth_connect),
        )
        .route(
            "/connections/oauth-revoke",
            post(routes::rpc::connections_oauth_revoke),
        )
        // C5 · RAG privileged writes: declassify (doc.declassify) + per-space retrieval config
        // (retrieval.manage).
        .route(
            "/documents/declassify",
            post(routes::rpc::documents_declassify),
        )
        .route(
            "/retrieval/set-config",
            post(routes::rpc::retrieval_set_config),
        )
        .route_layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            auth::require_auth,
        ));

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .nest("/v1", v1)
        .nest("/rpc", rpc)
        .layer(cors)
        .with_state(state);

    let listener = TcpListener::bind(format!("{}:{}", host, port)).await?;
    tracing::info!("torii-gateway listening on {}:{}", host, port);
    axum::serve(listener, app).await?;

    Ok(())
}

/// Probe Ollama at localhost:11434. Returns true only if the tags endpoint
/// responds with a 2xx status within 2 seconds.
async fn probe_ollama() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}
