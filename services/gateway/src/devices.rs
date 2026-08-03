//! O3-4 (P10) · device-fleet pure logic.
//!
//! Side-effect-free helpers for the fleet read model + sync-policy write, kept out of the
//! HTTP handlers so they unit-test without a DB or a wall clock (the caller passes `now`):
//!   - [`buffer_verdict`]     — render the D4-8 `buffer_health` jsonb into a fleet health
//!                              verdict (O3 §3.3). NULL-safe: a device that has never
//!                              reported is `unknown`, not a crash (D4-8 is the writer and
//!                              may not have landed yet).
//!   - [`is_drifted`]         — is a device's last-synced `config_version` behind the tenant
//!                              current (`config.config_versions.version`)?
//!   - [`validate_sync_policy`] — fail-closed validation for a `sync_policy` write (O3 §3.4).
//!   - [`stale_threshold_s`]  — operator-configurable stale threshold (env → const fallback,
//!                              per `project-gateway-no-hardcoded-ops`; Residual #11).
//!
//! Consumed by `routes::ledger::get_devices` (GET /v1/devices) and
//! `routes::rpc::devices_set_sync_policy` (POST /rpc/devices/set-sync-policy).

use chrono::{DateTime, Utc};
use serde_json::Value;

/// Fallback stale threshold (seconds): the age of the oldest **unflushed** buffer entry past
/// which a device's buffer is `stale`. Operator-overridable via `TORII_DEVICE_STALE_THRESHOLD_S`
/// — this const is only the fallback (`project-gateway-no-hardcoded-ops`). 15 minutes.
pub const DEFAULT_STALE_THRESHOLD_S: i64 = 900;

/// The operator-configured stale threshold in seconds (env override → const fallback).
/// A non-positive or unparseable override falls back to [`DEFAULT_STALE_THRESHOLD_S`].
pub fn stale_threshold_s() -> i64 {
    parse_stale_threshold(std::env::var("TORII_DEVICE_STALE_THRESHOLD_S").ok())
}

/// Pure parse of the stale-threshold override value → seconds. A non-positive or unparseable
/// override falls back to [`DEFAULT_STALE_THRESHOLD_S`]. Split out from [`stale_threshold_s`]
/// so the override precedence is unit-tested without mutating (process-global) env.
pub(crate) fn parse_stale_threshold(raw: Option<String>) -> i64 {
    raw.and_then(|v| v.parse::<i64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_STALE_THRESHOLD_S)
}

/// Allowed top-level keys in a `sync_policy` (O3 §3.4). Any other key is rejected — a device
/// must never receive a policy carrying keys it will not honour (fail-closed).
const SYNC_POLICY_KEYS: [&str; 4] = [
    "config_pull",
    "pull_interval_s",
    "offline_grace_h",
    "buffer_flush",
];

/// Rendered buffer-health verdict for the fleet read model (O3 §3.3), derived from the
/// D4-8 `buffer_health` jsonb `{usage_queued, audit_queued, last_flush_at, oldest_pending_at,
/// flush_status, clock_skew_ms}`. NULL-safe by design — D4-8 (the writer) may not have landed,
/// and an offline device simply has not reported.
///
/// Precedence (most-actionable first):
///   1. `unknown`  — no `buffer_health` reported yet (NULL / empty / not an object)
///   2. `failed`   — `flush_status = "failed"`
///   3. `stale`    — `oldest_pending_at` older than `stale_threshold_s`
///   4. `flushing` — `flush_status ∈ {flushing, retrying}` or entries still queued
///   5. `healthy`  — `flush_status = "ok"` and queues drained
pub fn buffer_verdict(
    buffer_health: Option<&Value>,
    now: DateTime<Utc>,
    stale_threshold_s: i64,
) -> &'static str {
    let bh = match buffer_health {
        Some(Value::Object(m)) if !m.is_empty() => m,
        _ => return "unknown",
    };
    let flush_status = bh.get("flush_status").and_then(Value::as_str).unwrap_or("");

    if flush_status == "failed" {
        return "failed";
    }
    // stale: the oldest still-unflushed entry is older than the operator threshold.
    if let Some(oldest) = bh.get("oldest_pending_at").and_then(Value::as_str) {
        if let Ok(ts) = DateTime::parse_from_rfc3339(oldest) {
            let age = now.signed_duration_since(ts.with_timezone(&Utc)).num_seconds();
            if age > stale_threshold_s {
                return "stale";
            }
        }
    }
    let queued = bh.get("usage_queued").and_then(Value::as_i64).unwrap_or(0)
        + bh.get("audit_queued").and_then(Value::as_i64).unwrap_or(0);
    if matches!(flush_status, "flushing" | "retrying") || queued > 0 {
        return "flushing";
    }
    if flush_status == "ok" {
        return "healthy";
    }
    "unknown"
}

/// Whether a device's last-synced `config_version` is behind the tenant's current version.
/// A tenant with no `config.config_versions` row yet (lazily created) → not drifted. A device
/// that has never synced (`None`) but whose tenant already has a version → drifted.
pub fn is_drifted(device_version: Option<i64>, tenant_version: Option<i64>) -> bool {
    match tenant_version {
        Some(tv) => device_version.unwrap_or(0) < tv,
        None => false,
    }
}

/// Validate a `sync_policy` write (O3 §3.4). Pure + DB-free → `Err(reason)` maps to `400`.
/// Fail-closed: every field is range/enum-checked and unknown keys are rejected, so a device
/// never receives a malformed or unrecognized policy.
pub fn validate_sync_policy(v: &Value) -> Result<(), &'static str> {
    let obj = v.as_object().ok_or("sync_policy_not_object")?;
    for k in obj.keys() {
        if !SYNC_POLICY_KEYS.contains(&k.as_str()) {
            return Err("unknown_key");
        }
    }

    let config_pull = obj.get("config_pull").and_then(Value::as_str);
    if !matches!(config_pull, Some("realtime") | Some("interval") | Some("manual")) {
        return Err("bad_config_pull");
    }

    // pull_interval_s: required + positive when config_pull=interval; if present, positive int.
    match obj.get("pull_interval_s") {
        Some(pv) => {
            let n = pv.as_i64().ok_or("bad_pull_interval_s")?;
            if n <= 0 {
                return Err("bad_pull_interval_s");
            }
        }
        None => {
            if config_pull == Some("interval") {
                return Err("pull_interval_s_required");
            }
        }
    }

    match obj.get("offline_grace_h") {
        Some(gv) => {
            let n = gv.as_i64().ok_or("bad_offline_grace_h")?;
            if n < 0 {
                return Err("bad_offline_grace_h");
            }
        }
        None => return Err("offline_grace_h_required"),
    }

    if !matches!(
        obj.get("buffer_flush").and_then(Value::as_str),
        Some("on_reconnect") | Some("interval")
    ) {
        return Err("bad_buffer_flush");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 23, 10, 15, 0).unwrap()
    }

    #[test]
    fn verdict_unknown_when_no_report() {
        assert_eq!(buffer_verdict(None, now(), 900), "unknown");
        assert_eq!(buffer_verdict(Some(&json!({})), now(), 900), "unknown");
        assert_eq!(buffer_verdict(Some(&Value::Null), now(), 900), "unknown");
        // a value with no recognizable status/queues/timestamp is still unknown, not healthy
        assert_eq!(buffer_verdict(Some(&json!({"clock_skew_ms": 5})), now(), 900), "unknown");
    }

    #[test]
    fn verdict_failed_wins_over_stale() {
        // failed is the most actionable: even with an old oldest_pending_at, report failed.
        let bh = json!({
            "flush_status": "failed",
            "oldest_pending_at": "2026-07-23T08:00:00Z", // >2h old
            "usage_queued": 3
        });
        assert_eq!(buffer_verdict(Some(&bh), now(), 900), "failed");
    }

    #[test]
    fn verdict_stale_when_oldest_past_threshold() {
        // oldest 30 min ago, threshold 15 min → stale (even though flush_status=ok).
        let bh = json!({
            "flush_status": "ok",
            "oldest_pending_at": "2026-07-23T09:45:00Z",
            "usage_queued": 2
        });
        assert_eq!(buffer_verdict(Some(&bh), now(), 900), "stale");
    }

    #[test]
    fn verdict_flushing_when_queued_or_in_progress() {
        // recent oldest + queued entries → flushing (not stale, not healthy).
        let recent = json!({
            "flush_status": "ok",
            "oldest_pending_at": "2026-07-23T10:14:00Z", // 60s ago < 900s
            "usage_queued": 4,
            "audit_queued": 0
        });
        assert_eq!(buffer_verdict(Some(&recent), now(), 900), "flushing");
        // explicit flushing/retrying status with empty queues is still flushing.
        assert_eq!(buffer_verdict(Some(&json!({"flush_status": "flushing"})), now(), 900), "flushing");
        assert_eq!(buffer_verdict(Some(&json!({"flush_status": "retrying"})), now(), 900), "flushing");
    }

    #[test]
    fn verdict_healthy_when_ok_and_drained() {
        let bh = json!({
            "flush_status": "ok",
            "oldest_pending_at": "2026-07-23T10:14:30Z",
            "usage_queued": 0,
            "audit_queued": 0,
            "last_flush_at": "2026-07-23T10:14:45Z"
        });
        assert_eq!(buffer_verdict(Some(&bh), now(), 900), "healthy");
        // ok with no pending timestamp and no queues is healthy too.
        assert_eq!(buffer_verdict(Some(&json!({"flush_status": "ok"})), now(), 900), "healthy");
    }

    #[test]
    fn drift_semantics() {
        assert!(is_drifted(Some(408), Some(412)), "behind → drifted");
        assert!(!is_drifted(Some(412), Some(412)), "in sync → not drifted");
        assert!(!is_drifted(Some(413), Some(412)), "ahead (impossible but safe) → not drifted");
        assert!(is_drifted(None, Some(2)), "never synced + tenant has config → drifted");
        assert!(!is_drifted(Some(5), None), "tenant has no config_versions row → not drifted");
        assert!(!is_drifted(None, None), "no data either side → not drifted");
    }

    #[test]
    fn sync_policy_accepts_the_default_shape() {
        let ok = json!({
            "config_pull": "realtime",
            "pull_interval_s": 300,
            "offline_grace_h": 72,
            "buffer_flush": "on_reconnect"
        });
        assert!(validate_sync_policy(&ok).is_ok());
        // interval mode with a positive pull_interval_s is valid.
        let interval = json!({
            "config_pull": "interval",
            "pull_interval_s": 600,
            "offline_grace_h": 24,
            "buffer_flush": "interval"
        });
        assert!(validate_sync_policy(&interval).is_ok());
        // manual mode may omit pull_interval_s.
        let manual = json!({"config_pull": "manual", "offline_grace_h": 0, "buffer_flush": "on_reconnect"});
        assert!(validate_sync_policy(&manual).is_ok());
    }

    #[test]
    fn sync_policy_rejects_bad_writes() {
        assert_eq!(validate_sync_policy(&json!("not-an-object")).unwrap_err(), "sync_policy_not_object");
        assert_eq!(
            validate_sync_policy(&json!({"offline_grace_h": 1, "buffer_flush": "interval"})).unwrap_err(),
            "bad_config_pull",
            "missing config_pull"
        );
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "weekly", "offline_grace_h": 1, "buffer_flush": "interval"})).unwrap_err(),
            "bad_config_pull"
        );
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "interval", "offline_grace_h": 1, "buffer_flush": "interval"})).unwrap_err(),
            "pull_interval_s_required"
        );
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "interval", "pull_interval_s": 0, "offline_grace_h": 1, "buffer_flush": "interval"})).unwrap_err(),
            "bad_pull_interval_s"
        );
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "realtime", "buffer_flush": "on_reconnect"})).unwrap_err(),
            "offline_grace_h_required"
        );
        // offline_grace_h present-but-invalid: negative and non-integer both fail closed.
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "manual", "offline_grace_h": -1, "buffer_flush": "on_reconnect"})).unwrap_err(),
            "bad_offline_grace_h"
        );
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "manual", "offline_grace_h": "abc", "buffer_flush": "on_reconnect"})).unwrap_err(),
            "bad_offline_grace_h"
        );
        // pull_interval_s present-but-non-integer (the as_i64 guard, distinct from the n<=0 path).
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "interval", "pull_interval_s": "soon", "offline_grace_h": 1, "buffer_flush": "interval"})).unwrap_err(),
            "bad_pull_interval_s"
        );
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "realtime", "offline_grace_h": 1})).unwrap_err(),
            "bad_buffer_flush"
        );
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "realtime", "offline_grace_h": 1, "buffer_flush": "hourly"})).unwrap_err(),
            "bad_buffer_flush"
        );
        // fail-closed on an unrecognized key.
        assert_eq!(
            validate_sync_policy(&json!({"config_pull": "manual", "offline_grace_h": 1, "buffer_flush": "interval", "danger": true})).unwrap_err(),
            "unknown_key"
        );
    }

    #[test]
    fn threshold_override_precedence() {
        assert_eq!(DEFAULT_STALE_THRESHOLD_S, 900);
        assert!(stale_threshold_s() > 0);
        // a valid positive override is honoured (invariant e: operator-overridable, not hardcoded)
        assert_eq!(parse_stale_threshold(Some("60".into())), 60);
        // unparseable / non-positive overrides fall back to the const default
        assert_eq!(parse_stale_threshold(None), DEFAULT_STALE_THRESHOLD_S);
        assert_eq!(parse_stale_threshold(Some("".into())), DEFAULT_STALE_THRESHOLD_S);
        assert_eq!(parse_stale_threshold(Some("banana".into())), DEFAULT_STALE_THRESHOLD_S);
        assert_eq!(parse_stale_threshold(Some("0".into())), DEFAULT_STALE_THRESHOLD_S);
        assert_eq!(parse_stale_threshold(Some("-5".into())), DEFAULT_STALE_THRESHOLD_S);
    }
}
