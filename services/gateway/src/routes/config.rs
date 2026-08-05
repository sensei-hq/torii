//! D4 · versioned config snapshot spine.
//!
//! [`bump`] increments a tenant's `config_version` + the touched component sub-version on every
//! config `/rpc/*` write (D4-1); [`get_snapshot`] serves the tenant's coherent, **credential-free**
//! config keyed by that atomic version, with a `since`→`304`/full contract (D4-2). This is the
//! spine every device consumer (hot-reload, offline cache, fleet parity) pulls through.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{auth::Claims, capabilities::check_claims_version, state::SharedState};

/// Bump a tenant's `config_version` + `component` sub-version after a config write. Best-effort:
/// a bump failure never fails the underlying write (the snapshot just lags by one version).
pub(crate) async fn bump(pool: &sqlx::PgPool, tenant: Uuid, component: &str) {
    if let Err(e) = sqlx::query("select config.bump_config_version($1, $2)")
        .bind(tenant)
        .bind(component)
        .execute(pool)
        .await
    {
        tracing::warn!("config bump ({component}) failed (best-effort): {e}");
    }
}

/// The resolved 4-state governance for a feature (O3-2). `governed` = a policy or the mandatory
/// floor decided it (vs the catalog default); `source` names the deciding scope.
pub(crate) struct FeatureState {
    pub enabled: bool,
    pub governed: bool,
    #[allow(dead_code)]
    pub source: String,
}

/// Resolve the effective governance of a feature for a caller via `config.resolve_feature_state`
/// (the single source of truth for the precedence). Fail-safe: a resolver error is treated as
/// ungoverned so the caller falls back to its own default rather than crashing the request.
pub(crate) async fn resolve_feature(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    role_ids: &[Uuid],
    feature: &str,
    space: Option<Uuid>,
) -> FeatureState {
    let v: Result<Value, _> = sqlx::query_scalar("select config.resolve_feature_state($1, $2, $3, $4)")
        .bind(tenant)
        .bind(role_ids)
        .bind(feature)
        .bind(space)
        .fetch_one(pool)
        .await;
    match v {
        Ok(j) => FeatureState {
            enabled: j.get("enabled").and_then(|b| b.as_bool()).unwrap_or(false),
            governed: j.get("governed").and_then(|b| b.as_bool()).unwrap_or(false),
            source: j
                .get("source")
                .and_then(|s| s.as_str())
                .unwrap_or("default")
                .to_string(),
        },
        Err(e) => {
            tracing::warn!("resolve_feature({feature}) failed (treated as ungoverned): {e}");
            FeatureState {
                enabled: false,
                governed: false,
                source: "error".into(),
            }
        }
    }
}

#[derive(Deserialize)]
pub struct SnapshotQuery {
    /// the caller's last-known `config_version`; equal ⇒ `304`, else a full snapshot.
    #[serde(default)]
    pub since: Option<i64>,
}

/// `GET /v1/config/snapshot?since=N` — the caller tenant's credential-free config snapshot keyed
/// by one atomic `config_version`. Any authenticated member of the tenant may read it (the desktop
/// pulls it to hot-reload). `since == config_version` ⇒ `304 Not Modified`; otherwise the full
/// snapshot (delta pulls are a tracked optimization). Contains **no** credential/key material —
/// cloud routing steps are labelled `plane` and carry no secret.
pub async fn get_snapshot(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<SnapshotQuery>,
) -> Response {
    let Some(tenant) = claims.tenant_id else {
        return (StatusCode::FORBIDDEN, "no active tenant").into_response();
    };
    if check_claims_version(&state.pool, &claims).await.is_err() {
        return (StatusCode::UNAUTHORIZED, "stale token — re-authenticate").into_response();
    }

    // Current version + component sub-versions (absent tenant row ⇒ version 0).
    let vc: Result<Option<(i64, Value)>, _> =
        sqlx::query_as("select version, components from config.config_versions where tenant_id = $1")
            .bind(tenant)
            .fetch_optional(&state.pool)
            .await;
    let (version, components) = match vc {
        Ok(Some((v, c))) => (v, c),
        Ok(None) => (0, json!({})),
        Err(e) => {
            tracing::error!("config snapshot version read: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    };

    // Unchanged since the caller's version → nothing to send.
    if q.since == Some(version) {
        return StatusCode::NOT_MODIFIED.into_response();
    }

    match assemble_snapshot(&state.pool, tenant).await {
        Ok(snapshot) => (
            StatusCode::OK,
            Json(json!({
                "config_version": version,
                "components": components,
                "snapshot": snapshot,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("config snapshot assemble: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// Assemble the credential-free config: routing chains (router→model, plane, sequence — NO keys),
/// the model catalog with per-tenant enablement, workspace settings, and resolved feature policies.
async fn assemble_snapshot(pool: &sqlx::PgPool, tenant: Uuid) -> sqlx::Result<Value> {
    let routing: Value = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.chain_name, t.sequence_order), '[]'::json) from ( \
           select fc.name as chain_name, fcm.sequence_order, fcm.plane, fcm.is_active, \
                  coalesce(r.name, '—') as router, coalesce(m.full_name, '—') as model \
             from catalog.chain_models fcm \
             join catalog.chains fc on fc.id = fcm.fallback_chain_id \
             left join catalog.models m on m.id = fcm.model_id \
             left join catalog.routers r on r.id = fcm.router_id \
            where fcm.tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await?;

    let catalog: Value = sqlx::query_scalar(
        // §D Phase 3: enablement is DERIVED from chain membership (no tenant_model_state) —
        // a model is enabled iff it appears in the tenant's resolved+viable chains.
        "select coalesce(json_agg(t order by t.full_name), '[]'::json) from ( \
           select m.full_name, \
                  exists(select 1 from catalog.chains_for_tenant cft \
                          where cft.tenant_id = $1 and cft.model_id = m.id) as enabled \
             from catalog.models m \
            where m.deprecated_on is null) t",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await?;

    // §D Phase 4: workspace toggles via the settings_for_tenant shield (tenant_settings absorbed).
    let settings: Value = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.setting_key), '[]'::json) from ( \
           select setting_key, enabled from governance.settings_for_tenant where tenant_id = $1) t",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await?;

    // §D Phase 4: the snapshot's workspace feature policies via the shield — `slug` (exposed over
    // the feature_id fold) as feature_key, the resolved workspace policy_state as state. Only
    // features WITH a workspace policy (policy_state not null), matching the prior scope-filtered read.
    let features: Value = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.feature_key), '[]'::json) from ( \
           select slug as feature_key, policy_state as state, 'workspace' as scope_type \
             from governance.feature_governance_for_tenant \
            where tenant_id = $1 and policy_state is not null) t",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await?;

    Ok(json!({
        "routing": routing,
        "catalog": catalog,
        "settings": settings,
        "features": features,
    }))
}

#[cfg(test)]
mod tests {
    //! Live-DB (55322). Ignored by default:
    //!   `cargo test -p torii-gateway -- --ignored config_snapshot`
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    async fn pool() -> sqlx::PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    /// The bump increments the version + component sub-version, and the assembled snapshot carries
    /// routing/catalog/settings/features for the tenant with **no** credential material.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn config_snapshot_bumps_version_and_leaks_no_credentials() {
        let pool = pool().await;
        let tenant = Uuid::new_v4();
        sqlx::query("insert into core.tenants (id, name, slug, modified_by) values ($1,'cfg',$2,'cfg')")
            .bind(tenant)
            .bind(format!("cfg-{tenant}"))
            .execute(&pool)
            .await
            .unwrap();
        // §D Phase 4: workspace toggles live in governance.settings (scope='workspace', jsonb bool).
        sqlx::query(
            "insert into governance.settings (tenant_id, scope, key, value, modified_by) \
             values ($1,'workspace','masking',to_jsonb(true),'cfg')",
        )
        .bind(tenant)
        .execute(&pool)
        .await
        .unwrap();
        // §D Phase 4: feature_policies is keyed by feature_id (FK) — use a real feature slug and
        // resolve it. 'fencing' is a seeded governance.features row.
        sqlx::query(
            "insert into governance.feature_policies (tenant_id, feature_id, scope_type, state) \
             select $1, f.id, 'workspace', 'locked' from governance.features f where f.slug = 'fencing'",
        )
        .bind(tenant)
        .execute(&pool)
        .await
        .unwrap();

        // two config writes → two bumps.
        bump(&pool, tenant, "settings").await;
        bump(&pool, tenant, "features").await;
        let (version, components): (i64, Value) =
            sqlx::query_as("select version, components from config.config_versions where tenant_id=$1")
                .bind(tenant)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(version, 2, "two bumps → monotonic version 2");
        assert_eq!(components["settings"], serde_json::json!(1));
        assert_eq!(components["features"], serde_json::json!(1));

        let snap = assemble_snapshot(&pool, tenant).await.unwrap();
        // the tenant's settings + features are present.
        assert!(snap["settings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["setting_key"] == "masking"));
        assert!(snap["features"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["feature_key"] == "fencing"));
        // the model catalog is present (seeded rows).
        assert!(!snap["catalog"].as_array().unwrap().is_empty());

        // NO credential material anywhere in the snapshot (setting_key/feature_key/full_name are
        // fine — we scan for real secret indicators only).
        let text = snap.to_string().to_lowercase();
        for bad in ["encrypted", "credential", "secret", "bearer", "password", "api_key"] {
            assert!(!text.contains(bad), "snapshot leaked '{bad}'");
        }

        sqlx::query("delete from core.tenants where id=$1")
            .bind(tenant)
            .execute(&pool)
            .await
            .unwrap();
    }

    /// O3-2 precedence via the Rust helper: a `locked` workspace policy beats a narrower
    /// `default-on`; a `role` policy beats `workspace`; no policy is ungoverned.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn resolve_feature_state_precedence() {
        let pool = pool().await;
        let tenant = Uuid::new_v4();
        let space = Uuid::new_v4();
        let role = Uuid::new_v4();
        sqlx::query("insert into core.tenants (id, name, slug, modified_by) values ($1,'fs',$2,'fs')")
            .bind(tenant)
            .bind(format!("fs-{tenant}"))
            .execute(&pool)
            .await
            .unwrap();
        // §D Phase 4: feature_policies is keyed by feature_id (FK) — use a real, mandatory=false
        // feature slug ('cost-tracking') so the resolver runs the precedence logic (a mandatory
        // feature would short-circuit to 'mandatory'). The insert resolves slug→feature_id.
        let policy = |scope: &'static str, sid: Option<Uuid>, state: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "insert into governance.feature_policies (tenant_id, feature_id, scope_type, scope_id, state) \
                     select $1, f.id, $2::governance.feature_scope, $3, $4::governance.feature_state \
                       from governance.features f where f.slug = 'cost-tracking'",
                )
                .bind(tenant)
                .bind(scope)
                .bind(sid)
                .bind(state)
                .execute(&pool)
                .await
                .unwrap();
            }
        };
        let clear = || {
            let pool = pool.clone();
            async move {
                sqlx::query("delete from governance.feature_policies where tenant_id=$1")
                    .bind(tenant)
                    .execute(&pool)
                    .await
                    .unwrap();
            }
        };

        // locked@workspace beats space=default-on → OFF, governed, source locked@workspace.
        policy("workspace", None, "locked").await;
        policy("space", Some(space), "default-on").await;
        let fs = resolve_feature(&pool, tenant, &[role], "cost-tracking", Some(space)).await;
        assert!(!fs.enabled && fs.governed && fs.source == "locked@workspace");

        // role (default-on) beats workspace (default-off) → ON, source role.
        clear().await;
        policy("role", Some(role), "default-on").await;
        policy("workspace", None, "default-off").await;
        let fs = resolve_feature(&pool, tenant, &[role], "cost-tracking", Some(space)).await;
        assert!(fs.enabled && fs.governed && fs.source == "role");

        // no policy for an unknown feature → ungoverned default-off (the caller decides).
        let fs = resolve_feature(&pool, tenant, &[role], "no-such-feature", None).await;
        assert!(!fs.enabled && !fs.governed);

        sqlx::query("delete from core.tenants where id=$1")
            .bind(tenant)
            .execute(&pool)
            .await
            .unwrap();
    }
}
