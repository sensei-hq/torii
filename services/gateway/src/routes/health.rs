use axum::Json;
use serde_json::{json, Value};

/// `GET /health` — liveness + **which build is live** probe.
///
/// `version` is the crate version `make bump` moves in lockstep with the repo `VERSION`. On
/// its own it does NOT identify a build: every binary compiled between two bumps reports the
/// same string, so a process running a fortnight-old binary is indistinguishable from a fresh
/// one. That is not hypothetical — a launchd-supervised gateway served a schema it predated
/// while reporting `status: ok` and the then-current version.
///
/// `built_at` (RFC3339 UTC) and `commit` (short SHA, `-dirty` when the tree was not clean,
/// `unknown` without git) are baked in by `build.rs` and are the actual discriminators. Use
/// them, not `version`, to answer "did my push really deploy?" and "is this binary current?".
pub async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "torii-gateway",
        "version": env!("CARGO_PKG_VERSION"),
        "built_at": env!("TORII_BUILT_AT"),
        "commit": env!("TORII_COMMIT"),
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

    /// Regression: the version alone cannot identify a BUILD. Every binary compiled from the
    /// same commit-range reports the same `version`, so a process running a two-week-old
    /// binary is indistinguishable from a fresh one — which is exactly how a stale
    /// launchd-supervised gateway served a schema it predated while reporting `status: ok`.
    /// `built_at` is the discriminator; `commit` pins it to a revision when git is available.
    #[tokio::test]
    async fn health_identifies_the_build_not_just_the_version() {
        let Json(v) = health().await;

        let built_at = v["built_at"].as_str().expect("built_at must be present");
        // RFC3339 UTC, e.g. 2026-09-18T13:45:02Z — parseable, not a free-form string, so a
        // staleness check can do arithmetic on it rather than string-matching.
        assert!(
            chrono::DateTime::parse_from_rfc3339(built_at).is_ok(),
            "built_at must be RFC3339, got {built_at:?}"
        );

        let commit = v["commit"].as_str().expect("commit must be present");
        // "unknown" is the honest fallback when building without a .git dir (e.g. a Docker
        // build that does not COPY it) — empty would read as "no answer" rather than "asked".
        assert!(!commit.is_empty(), "commit must never be empty; use \"unknown\"");
    }
}
