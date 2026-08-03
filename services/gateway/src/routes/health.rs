use axum::Json;
use serde_json::{json, Value};

/// `GET /health` — liveness + **deployed-version** probe. Reports the crate version baked in
/// at compile time (`CARGO_PKG_VERSION`), which `make bump` moves in lockstep with the repo
/// `VERSION`. So `curl <host>/health` proves exactly which build is live — the verifiable
/// ground truth for "did my push actually deploy?" (don't assume a deploy; check the version).
pub async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "torii-gateway",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_reports_status_and_deployed_version() {
        let Json(v) = health().await;
        assert_eq!(v["status"], "ok");
        assert_eq!(v["service"], "torii-gateway");
        // version is the compile-time crate version (bumped by `make bump`), never empty.
        assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
        assert!(!v["version"].as_str().unwrap().is_empty());
    }
}
