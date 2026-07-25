use std::sync::Arc;

use axum::{middleware, routing::{get, post}, Router};
use axum::http::{
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    Method,
};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

// MIG-2 (v0.4.6): `InferenceAdapter` was deleted — adapters now impl the
// capability-segregated traits (ChatModel/EmbedModel/…) + `RegisterInto`, and
// `AdapterRegistry::register(Arc::new(adapter))` dispatches via `RegisterInto`
// (no `dyn InferenceAdapter` cast). Cloud adapters are re-exported under the
// historical `gateway::adapters::<provider>` paths (feature `cloud`, default-on).
use gateway::adapters::AdapterRegistry;
use gateway::adapters::noop::NoopAdapter;
use gateway::circuit_breaker::{CircuitBreakerConfig, CircuitBreakerManager};
use gateway::Gateway;

mod apikeys;  // H2: API-key generation + argon2 hash/verify (identity-bound)
mod auth;
mod budgets;  // C3: budget-node resolution + hard reserve→commit on the inference hot path
mod capabilities;  // F2: server-side capability resolution + claims-version gate
mod config_loader;
mod crypto;   // F3: DEK/KEK envelope crypto
mod keys;
mod quality;  // C6: quality-signal capture (one implicit batch per inference call)
mod redact;   // C4: secret/PII redaction (DLP, §2 W5)
mod routes;
mod state;
mod store;
mod vault;    // F3: DB-backed credential vault (replaces the env-key shim)

use state::{AppState, SharedState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "strategos_gateway=info,tower_http=info".into()),
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

    // Connect Postgres pool
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    tracing::info!("Database connected");

    // Fetch JWKS from Supabase at startup.
    // Degrades gracefully — an empty JWKS means auth will fail fast with 401
    // until Supabase comes up and the middleware refetches on the first kid miss.
    let jwks = auth::fetch_jwks(&supabase_url).await;

    // Build the gateway adapter registry
    let adapters = AdapterRegistry::new();

    // Always register noop as graceful degradation fallback
    adapters
        .register(Arc::new(NoopAdapter))
        .await;

    // Probe Ollama at localhost:11434 before registering
    if probe_ollama().await {
        match gateway::adapters::ollama::OllamaAdapter::new() {
            Ok(adapter) => {
                tracing::info!("Gateway: Ollama adapter registered");
                adapters
                    .register(Arc::new(adapter))
                    .await;
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
            adapters
                .register(Arc::new(adapter))
                .await;
        }
        Err(e) => tracing::warn!("Gateway: Anthropic adapter failed: {}", e),
    }

    match gateway::adapters::openai::OpenAIAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: OpenAI adapter registered");
            adapters
                .register(Arc::new(adapter))
                .await;
        }
        Err(e) => tracing::warn!("Gateway: OpenAI adapter failed: {}", e),
    }

    // OpenAI-compatible aggregators/gateways (same wire format, distinct router id)
    for id in ["openrouter", "vercel", "nvidia"] {
        match gateway::adapters::openai::OpenAIAdapter::with_id(id) {
            Ok(adapter) => {
                tracing::info!("Gateway: OpenAI-compatible adapter registered as '{id}'");
                adapters
                    .register(Arc::new(adapter))
                    .await;
            }
            Err(e) => tracing::warn!("Gateway: '{id}' adapter failed: {e}"),
        }
    }

    match gateway::adapters::grok::GrokAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: Grok adapter registered");
            adapters
                .register(Arc::new(adapter))
                .await;
        }
        Err(e) => tracing::warn!("Gateway: Grok adapter failed: {}", e),
    }

    match gateway::adapters::gemini::GeminiAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: Gemini adapter registered");
            adapters
                .register(Arc::new(adapter))
                .await;
        }
        Err(e) => tracing::warn!("Gateway: Gemini adapter failed: {}", e),
    }

    // Bedrock uses the AWS SDK credential-provider chain; constructs without
    // needing credentials present — fails at request time if credentials are absent.
    match gateway::adapters::bedrock::BedrockAdapter::new().await {
        Ok(adapter) => {
            tracing::info!("Gateway: Bedrock adapter registered");
            adapters
                .register(Arc::new(adapter))
                .await;
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
    let gw = Gateway::new(config, adapters, cb);

    // Inject provider (BYOK) keys from the process environment (Task 5).
    // F3 vault decryption is deferred; keys resolve via std::env::var.
    gw.refresh_router_keys(keys::env_key_resolver(router_env.clone())).await;
    let resolved = router_env.values().filter(|v| std::env::var(v).is_ok()).count();
    let total = router_env.len();
    tracing::info!("keys: {}/{} routers have a provider key in env", resolved, total);

    let state: SharedState = Arc::new(AppState {
        pool,
        gateway: Arc::new(gw),
        jwks: RwLock::new(jwks),
    });

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
        .allow_headers([CONTENT_TYPE, ACCEPT, AUTHORIZATION]);

    // `/v1` routes — all require a valid Supabase JWT.
    // Routes added BEFORE route_layer inherit the auth middleware.
    let v1 = Router::new()
        .route("/whoami", get(routes::whoami::whoami))
        .route("/chat", post(routes::chat::post_chat))
        .route("/chat/stream", post(routes::chat::post_chat_stream))
        .route("/status", get(routes::status::get_status))
        .route_layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            auth::require_auth,
        ));

    // `/rpc` — gateway-mediated privileged writes (DECISIONS §5a). Same auth
    // middleware as `/v1`; each handler additionally resolves capabilities +
    // runs the claims-version freshness gate server-side.
    let rpc = Router::new()
        .route("/budgets/upsert-node", post(routes::rpc::budgets_upsert_node))
        .route("/budgets/request", post(routes::rpc::budgets_request))
        .route("/budgets/approve-request", post(routes::rpc::budgets_approve_request))
        .route("/apikeys/issue", post(routes::rpc::apikeys_issue))
        .route("/rbac/assign-role", post(routes::rpc::rbac_assign_role))
        .route("/governance/set-feature", post(routes::rpc::governance_set_feature))
        .route("/spaces/create", post(routes::rpc::spaces_create))
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

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    tracing::info!("strategos-gateway listening on 127.0.0.1:{}", port);
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
