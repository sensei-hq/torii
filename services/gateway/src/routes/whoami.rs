use axum::{extract::State, Extension, Json};
use serde_json::{json, Value};

use crate::{auth::Claims, capabilities::CapabilitySet, state::SharedState};

/// `GET /v1/whoami` — the validated JWT claims + the **server-resolved** capability
/// set. The capability list is for client UX gating only (which controls to show);
/// every privileged mutation is independently capability-checked server-side, so a
/// hidden control invoked directly still returns 403.
pub async fn whoami(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Json<Value> {
    let capabilities = CapabilitySet::resolve(&state.pool, &claims)
        .await
        .map(|c| c.list())
        .unwrap_or_default();
    Json(json!({
        "sub": claims.sub,
        "tenant_id": claims.tenant_id,
        "role": claims.role,
        "capabilities": capabilities,
    }))
}
