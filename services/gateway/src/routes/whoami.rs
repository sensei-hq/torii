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
    // The tenant's display name for the client shell. Filtered by the VALIDATED token
    // tenant_id (a token can only ever read its own tenant's name — no cross-tenant
    // leak); best-effort (None → the client falls back to a neutral label).
    let tenant_name: Option<String> = match claims.tenant_id {
        Some(tid) => sqlx::query_scalar::<_, String>("select name from core.tenants where id = $1")
            .bind(tid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten(),
        None => None,
    };
    Json(json!({
        "sub": claims.sub,
        "tenant_id": claims.tenant_id,
        "tenant_name": tenant_name,
        "role": claims.role,
        "capabilities": capabilities,
    }))
}
