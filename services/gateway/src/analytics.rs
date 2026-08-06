//! O2 · analytics query builders — pure, DB-free mapping of API params → SQL fragments.
//!
//! The P12 acceptance gate rides on `group_by` mapping to a **denormalized attribution
//! column** on `inference_calls` (`{org,dept,team,user}_node_id`, GH-5) — so per-scope
//! spend groups with **no recursive budget-tree walk**. Every column here is drawn from a
//! closed enum, never raw input, so interpolating it into SQL carries no injection risk.
//! These builders are unit-tested with no DB; the route layer runs the assembled SQL and
//! an `EXPLAIN` check asserts the absence of a recursive CTE.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

/// A bad analytics query parameter → `400` (or `422` for an unknown metric). Carries a
/// stable machine code so the TS clients can branch without string-matching prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamError {
    Window,
    GroupBy,
    Bucket,
    Report,
}

impl ParamError {
    fn code(self) -> &'static str {
        match self {
            ParamError::Window => "bad_window",
            ParamError::GroupBy => "bad_group_by",
            ParamError::Bucket => "bad_bucket",
            ParamError::Report => "bad_report",
        }
    }
}

impl IntoResponse for ParamError {
    fn into_response(self) -> Response {
        (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": self.code() })),
        )
            .into_response()
    }
}

/// A validated analytics window = the trailing `days`. Parsed from `?window=14d`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub days: i32,
}

impl Window {
    /// Accepts `"<N>d"`, 1..=366. Absent → 14d default.
    pub fn parse(raw: Option<&str>) -> Result<Window, ParamError> {
        let s = raw.unwrap_or("14d").trim();
        let days = s
            .strip_suffix('d')
            .and_then(|n| n.parse::<i32>().ok())
            .ok_or(ParamError::Window)?;
        if !(1..=366).contains(&days) {
            return Err(ParamError::Window);
        }
        Ok(Window { days })
    }
}

/// The time bucket for trend series. v1 supports day-grained rollups only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bucket {
    Day,
}

impl Bucket {
    pub fn parse(raw: Option<&str>) -> Result<Bucket, ParamError> {
        match raw.unwrap_or("day").trim() {
            "day" => Ok(Bucket::Day),
            _ => Err(ParamError::Bucket),
        }
    }
}

/// The spend grouping dimension. NODE dims map to a denormalized `*_node_id` path column
/// (grouping needs no recursion); ATTRIBUTE dims group by a scalar ledger column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpendGroup {
    Org,
    Dept,
    Team,
    User,
    Model,
    Provider,
    Capability,
}

impl SpendGroup {
    pub fn parse(raw: &str) -> Result<SpendGroup, ParamError> {
        Ok(match raw.trim() {
            "org" => SpendGroup::Org,
            "dept" => SpendGroup::Dept,
            "team" => SpendGroup::Team,
            "user" => SpendGroup::User,
            "model" => SpendGroup::Model,
            "provider" => SpendGroup::Provider,
            "capability" => SpendGroup::Capability,
            _ => return Err(ParamError::GroupBy),
        })
    }

    /// §D Ledger Normalize LN-3c-2b (the P12 REVERSAL): node dims no longer map to a denormalized
    /// `*_node_id` column (those were dropped). A node dim is now a TIER LEVEL (org=0…user=3); spend_sql
    /// resolves each call's leaf `org_unit_id` to its ancestor at that level via
    /// `core.org_unit_ancestor_at_level` (a per-call tree walk — the deliberate perf-for-simplicity trade).
    /// Attribute dims (model/provider/capability) still group by a scalar ledger column.
    pub fn level(self) -> Option<i32> {
        match self {
            SpendGroup::Org => Some(0),
            SpendGroup::Dept => Some(1),
            SpendGroup::Team => Some(2),
            SpendGroup::User => Some(3),
            _ => None,
        }
    }

    /// The scalar `inference_calls` column for ATTRIBUTE dims (node dims resolve via level()).
    /// Returns a compile-time-fixed identifier (injection-safe).
    pub fn attr_column(self) -> &'static str {
        match self {
            SpendGroup::Model => "model",
            SpendGroup::Provider => "adapter",
            SpendGroup::Capability => "capability",
            _ => "", // node dims → resolved via level(); attr_column is never used for them
        }
    }

    /// True for the org→dept→team→user tree dims (resolved via the org-tree ancestor walk + joined to
    /// core.org_units + governance.nodes for name/cap).
    pub fn is_node(self) -> bool {
        self.level().is_some()
    }
}

/// The report a `/v1/analytics/export` call may request — AGGREGATED analytics only. Raw
/// per-call/SIEM export is O1's surface, so `raw-calls` (etc.) is rejected here by design.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportReport {
    CostTrend,
    ModelMix,
    PlaneSplit,
    Spend,
    Quality,
}

impl ExportReport {
    pub fn parse(raw: &str) -> Result<ExportReport, ParamError> {
        Ok(match raw.trim() {
            "cost-trend" => ExportReport::CostTrend,
            "model-mix" => ExportReport::ModelMix,
            "plane-split" => ExportReport::PlaneSplit,
            "spend" => ExportReport::Spend,
            "quality" => ExportReport::Quality,
            _ => return Err(ParamError::Report),
        })
    }
}

// ── A7 · scope authz ─────────────────────────────────────────────────────────
use uuid::Uuid;

/// The resolved read scope for one analytics request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopeFilter {
    /// Tenant-wide — no node filter (only an `audit.read` holder gets this).
    All,
    /// Confined to these `org_unit_id`s (a node's subtree). Empty ⇒ sees nothing.
    Nodes(Vec<Uuid>),
}

impl ScopeFilter {
    /// The bind value for the `= any($n)` predicate: `None` for `All` (predicate is a
    /// no-op), else the node-id set. Every scoped query filters `org_unit_id`.
    pub fn bind(&self) -> Option<Vec<Uuid>> {
        match self {
            ScopeFilter::All => None,
            ScopeFilter::Nodes(v) => Some(v.clone()),
        }
    }
}

/// Outcome of the scope-authz decision (before the subtree is materialized).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeDecision {
    /// Tenant-wide (audit.read holder, no scope requested).
    Unrestricted,
    /// Confine to this node's subtree.
    Scope(Uuid),
    /// Requested a scope the caller may not see, or has no scope at all → 403.
    Denied,
}

/// Pure scope-authz decision. `own_leaf` is the caller's PERSONAL budget node (no org-root
/// fallback — that would leak tenant-wide); `requested_in_own` is whether the requested
/// node lies in the caller's own subtree. Own-subtree reads need no capability; tenant-wide
/// / cross-subtree needs `audit.read` (`has_wide`).
pub fn scope_decision(
    has_wide: bool,
    requested: Option<Uuid>,
    own_leaf: Option<Uuid>,
    requested_in_own: bool,
) -> ScopeDecision {
    match (has_wide, requested, own_leaf) {
        (true, Some(s), _) => ScopeDecision::Scope(s), // admin may scope anywhere
        (true, None, _) => ScopeDecision::Unrestricted, // admin, tenant-wide
        (false, Some(s), Some(_)) if requested_in_own => ScopeDecision::Scope(s),
        (false, Some(_), _) => ScopeDecision::Denied,  // out-of-subtree without audit.read
        (false, None, Some(own)) => ScopeDecision::Scope(own), // confined to own subtree
        (false, None, None) => ScopeDecision::Denied,  // no personal node + no audit.read
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_parses_days_and_defaults() {
        assert_eq!(Window::parse(None).unwrap().days, 14);
        assert_eq!(Window::parse(Some("7d")).unwrap().days, 7);
        assert_eq!(Window::parse(Some("30d")).unwrap().days, 30);
    }

    #[test]
    fn window_rejects_garbage_and_out_of_range() {
        for bad in ["", "d", "14", "0d", "500d", "-3d", "14w", "abc"] {
            assert_eq!(Window::parse(Some(bad)), Err(ParamError::Window), "{bad}");
        }
    }

    #[test]
    fn bucket_only_day() {
        assert_eq!(Bucket::parse(None).unwrap(), Bucket::Day);
        assert_eq!(Bucket::parse(Some("day")).unwrap(), Bucket::Day);
        assert_eq!(Bucket::parse(Some("hour")), Err(ParamError::Bucket));
    }

    #[test]
    fn spend_group_node_dims_map_to_tier_levels() {
        // §D LN-3c-2b (P12 reversal): tree dims are now TIER LEVELS (org=0…user=3); spend_sql resolves
        // each call's leaf org_unit to its ancestor at that level via core.org_unit_ancestor_at_level.
        assert_eq!(SpendGroup::parse("org").unwrap().level(), Some(0));
        assert_eq!(SpendGroup::parse("dept").unwrap().level(), Some(1));
        assert_eq!(SpendGroup::parse("team").unwrap().level(), Some(2));
        assert_eq!(SpendGroup::parse("user").unwrap().level(), Some(3));
        assert!(SpendGroup::parse("team").unwrap().is_node());
    }

    #[test]
    fn spend_group_maps_attribute_dims() {
        assert_eq!(SpendGroup::parse("model").unwrap().attr_column(), "model");
        assert_eq!(SpendGroup::parse("provider").unwrap().attr_column(), "adapter");
        assert_eq!(SpendGroup::parse("capability").unwrap().attr_column(), "capability");
        assert_eq!(SpendGroup::parse("model").unwrap().level(), None);
        assert!(!SpendGroup::parse("model").unwrap().is_node());
    }

    #[test]
    fn spend_group_rejects_unknown() {
        assert_eq!(SpendGroup::parse("region"), Err(ParamError::GroupBy));
        assert_eq!(SpendGroup::parse(""), Err(ParamError::GroupBy));
    }

    #[test]
    fn export_report_rejects_raw_rows() {
        // Raw per-call export is O1's surface — O2 export is aggregates only.
        assert_eq!(ExportReport::parse("raw-calls"), Err(ParamError::Report));
        assert_eq!(ExportReport::parse("audit"), Err(ParamError::Report));
        assert!(ExportReport::parse("plane-split").is_ok());
    }

    #[test]
    fn scope_admin_is_unrestricted_or_any_scope() {
        let s = Uuid::new_v4();
        // audit.read holder: tenant-wide when unscoped, any node when scoped.
        assert_eq!(scope_decision(true, None, None, false), ScopeDecision::Unrestricted);
        assert_eq!(scope_decision(true, Some(s), None, false), ScopeDecision::Scope(s));
    }

    #[test]
    fn scope_member_confined_to_own_subtree() {
        let own = Uuid::new_v4();
        let child = Uuid::new_v4();
        let sibling = Uuid::new_v4();
        // no audit.read, no scope → confined to own subtree.
        assert_eq!(scope_decision(false, None, Some(own), false), ScopeDecision::Scope(own));
        // requesting a node WITHIN own subtree → allowed (narrowing).
        assert_eq!(scope_decision(false, Some(child), Some(own), true), ScopeDecision::Scope(child));
        // requesting a node OUTSIDE own subtree → denied (needs audit.read).
        assert_eq!(scope_decision(false, Some(sibling), Some(own), false), ScopeDecision::Denied);
    }

    #[test]
    fn scope_member_without_personal_node_is_denied() {
        // No personal node + no audit.read → no scope at all → deny (fail-closed, never
        // falls back to the org root, which would leak tenant-wide).
        assert_eq!(scope_decision(false, None, None, false), ScopeDecision::Denied);
        assert_eq!(scope_decision(false, Some(Uuid::new_v4()), None, false), ScopeDecision::Denied);
    }

    #[test]
    fn scope_filter_bind() {
        assert_eq!(ScopeFilter::All.bind(), None);
        let n = Uuid::new_v4();
        assert_eq!(ScopeFilter::Nodes(vec![n]).bind(), Some(vec![n]));
    }
}
