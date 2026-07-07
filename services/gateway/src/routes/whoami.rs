use axum::{Extension, Json};
use serde_json::{json, Value};

use crate::auth::Claims;

/// `GET /v1/whoami` — echoes the validated JWT claims.
/// Requires a valid Supabase JWT (enforced by the `require_auth` middleware on
/// the `/v1` route group). Useful as a liveness probe for auth end-to-end.
pub async fn whoami(Extension(claims): Extension<Claims>) -> Json<Value> {
    Json(json!({
        "sub": claims.sub,
        "tenant_id": claims.tenant_id,
        "role": claims.role,
    }))
}
