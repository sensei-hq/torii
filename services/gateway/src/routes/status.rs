use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::state::SharedState;

/// `GET /v1/status` — reports gateway configuration state.
///
/// Returns which adapters are registered, what models are configured,
/// and whether the gateway is ready to serve inference requests.
pub async fn get_status(
    State(state): State<SharedState>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let configured = state.gateway.is_configured().await;
    let adapters = state.gateway.list_adapters().await;
    let models = state
        .gateway
        .list_models()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({
        "configured": configured,
        "adapters": adapters,
        "models": models,
    })))
}
