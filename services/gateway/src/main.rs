use std::sync::Arc;

use axum::{routing::get, Router};
use axum::http::{
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    Method,
};
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

use gateway::adapters::{AdapterRegistry, InferenceAdapter};
use gateway::adapters::noop::NoopAdapter;
use gateway::circuit_breaker::{CircuitBreakerConfig, CircuitBreakerManager};
use gateway::Gateway;

mod config_loader;
mod routes;
mod state;
mod store;

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
        .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:54322/postgres".to_string());

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

    // Build the gateway adapter registry
    let adapters = AdapterRegistry::new();

    // Always register noop as graceful degradation fallback
    adapters
        .register(Arc::new(NoopAdapter) as Arc<dyn InferenceAdapter>)
        .await;

    // Probe Ollama at localhost:11434 before registering
    if probe_ollama().await {
        match gateway::adapters::ollama::OllamaAdapter::new() {
            Ok(adapter) => {
                tracing::info!("Gateway: Ollama adapter registered");
                adapters
                    .register(Arc::new(adapter) as Arc<dyn InferenceAdapter>)
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
                .register(Arc::new(adapter) as Arc<dyn InferenceAdapter>)
                .await;
        }
        Err(e) => tracing::warn!("Gateway: Anthropic adapter failed: {}", e),
    }

    match gateway::adapters::openai::OpenAIAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: OpenAI adapter registered");
            adapters
                .register(Arc::new(adapter) as Arc<dyn InferenceAdapter>)
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
                    .register(Arc::new(adapter) as Arc<dyn InferenceAdapter>)
                    .await;
            }
            Err(e) => tracing::warn!("Gateway: '{id}' adapter failed: {e}"),
        }
    }

    match gateway::adapters::grok::GrokAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: Grok adapter registered");
            adapters
                .register(Arc::new(adapter) as Arc<dyn InferenceAdapter>)
                .await;
        }
        Err(e) => tracing::warn!("Gateway: Grok adapter failed: {}", e),
    }

    match gateway::adapters::gemini::GeminiAdapter::new() {
        Ok(adapter) => {
            tracing::info!("Gateway: Gemini adapter registered");
            adapters
                .register(Arc::new(adapter) as Arc<dyn InferenceAdapter>)
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
                .register(Arc::new(adapter) as Arc<dyn InferenceAdapter>)
                .await;
        }
        Err(e) => tracing::warn!("Gateway: Bedrock adapter failed: {}", e),
    }

    // Load the real GatewayConfig from the Postgres config tables (Task 4).
    // Reads config.routers, config.models, and public.fallback_chains for the
    // platform tenant; logs router/model/chain counts on success.
    let config = config_loader::load_gateway_config(&pool).await?;
    let cb = CircuitBreakerManager::new(CircuitBreakerConfig::default());
    let gw = Gateway::new(config, adapters, cb);

    let state: SharedState = Arc::new(AppState {
        pool,
        gateway: Arc::new(gw),
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

    let app = Router::new()
        .route("/health", get(routes::health::health))
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
