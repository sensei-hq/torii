//! F2 · server-side capability resolution + the claims-version freshness gate.
//!
//! The JWT carries only `tenant_id` + `role_ids[]` + `claims_version` (F2 §4.1).
//! C1 resolves the effective capability set from `core.effective_role_permissions` (shared
//! defaults + tenant customs) for those role ids — the token is NEVER trusted for capabilities.
//! Every privileged
//! `/rpc/*` handler calls [`CapabilitySet::require`] before it writes.
//!
//! Freshness: [`check_claims_version`] rejects a token whose `claims_version` is
//! behind `core.profiles.claims_version` (the downgrade-revocation gate, RW2).

use std::collections::HashSet;

use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::Claims;

/// A resolved, server-side capability set for one request.
#[derive(Debug, Clone, Default)]
pub struct CapabilitySet(HashSet<String>);

impl CapabilitySet {
    /// Resolve the union of capabilities granted to the JWT's `role_ids` in its
    /// tenant. Empty (no capabilities) when the token has no tenant/roles.
    pub async fn resolve(pool: &PgPool, claims: &Claims) -> anyhow::Result<Self> {
        let (Some(tenant_id), false) = (claims.tenant_id, claims.role_ids.is_empty()) else {
            return Ok(Self::default());
        };
        // Read the effective view (shared defaults expanded per tenant + customs), so default-role
        // grants (stored tenant_id NULL) resolve — the WHERE stays tenant-scoped by role_id.
        let rows = sqlx::query(
            "select distinct capability from core.effective_role_permissions \
             where tenant_id = $1 and role_id = any($2)",
        )
        .bind(tenant_id)
        .bind(&claims.role_ids)
        .fetch_all(pool)
        .await?;
        Ok(Self(
            rows.into_iter()
                .filter_map(|r| r.try_get::<String, _>("capability").ok())
                .collect(),
        ))
    }

    pub fn has(&self, capability: &str) -> bool {
        self.0.contains(capability)
    }

    /// The resolved capability keys, sorted — for client UX gating via `/v1/whoami`
    /// (advisory only; every mutation is independently capability-checked server-side).
    pub fn list(&self) -> Vec<String> {
        let mut v: Vec<String> = self.0.iter().cloned().collect();
        v.sort();
        v
    }

    /// Ok(()) if the capability is held, else a 403-mapped error.
    pub fn require(&self, capability: &str) -> Result<(), CapabilityError> {
        if self.has(capability) {
            Ok(())
        } else {
            Err(CapabilityError::Missing(capability.to_string()))
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CapabilityError {
    #[error("missing capability: {0}")]
    Missing(String),
    #[error("token is stale (claims_version behind) — re-authenticate")]
    StaleToken,
}

/// The downgrade-revocation gate: reject a token whose `claims_version` is behind
/// the user's current `core.profiles.claims_version`.
pub async fn check_claims_version(pool: &PgPool, claims: &Claims) -> Result<(), CapabilityError> {
    let uid = match Uuid::parse_str(&claims.sub) {
        Ok(u) => u,
        Err(_) => return Err(CapabilityError::StaleToken),
    };
    // Fail CLOSED: pass ONLY when the profile row exists AND the token is at least
    // as fresh as it. A missing row (hard-deleted / revoked identity) or any DB
    // error is treated as stale — never `.ok().flatten()` past a security gate.
    let current: Result<Option<i64>, sqlx::Error> =
        sqlx::query_scalar("select claims_version from core.profiles where id = $1")
            .bind(uid)
            .fetch_optional(pool)
            .await;
    match current {
        Ok(Some(v)) if v <= claims.claims_version => Ok(()),
        Ok(Some(_)) => Err(CapabilityError::StaleToken),
        Ok(None) => Err(CapabilityError::StaleToken),
        Err(_) => Err(CapabilityError::StaleToken),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims_for(sub: &str, claims_version: i64) -> Claims {
        Claims {
            sub: sub.to_string(),
            tenant_id: None,
            role_ids: vec![],
            claims_version,
            role: None,
            exp: 4_102_444_800,
            aud: None,
        }
    }

    /// Fail-closed revocation gate (finding #6): a subject with NO profile row and
    /// an unparseable subject must both be REJECTED, while an existing profile whose
    /// `claims_version` is not ahead of the token is accepted. DB-gated: skips
    /// silently when `DATABASE_URL` is unset so the plain unit run stays offline.
    #[tokio::test]
    async fn check_claims_version_fails_closed_on_missing_row() {
        let Ok(url) = std::env::var("DATABASE_URL") else {
            eprintln!("skip check_claims_version test: DATABASE_URL unset");
            return;
        };
        let pool = PgPool::connect(&url).await.expect("connect");

        // Unparseable subject → stale (never trusts a malformed token).
        assert!(matches!(
            check_claims_version(&pool, &claims_for("not-a-uuid", 0)).await,
            Err(CapabilityError::StaleToken)
        ));

        // Missing profile row (hard-deleted / revoked identity) → stale, NOT Ok.
        let ghost = Uuid::new_v4().to_string();
        assert!(matches!(
            check_claims_version(&pool, &claims_for(&ghost, 0)).await,
            Err(CapabilityError::StaleToken)
        ));

        // Existing profile: fresh token (>= profile) passes, older token is stale.
        if let Ok(Some((id, ver))) =
            sqlx::query_as::<_, (Uuid, i64)>("select id, claims_version from core.profiles limit 1")
                .fetch_optional(&pool)
                .await
        {
            let sub = id.to_string();
            assert!(check_claims_version(&pool, &claims_for(&sub, ver))
                .await
                .is_ok());
            assert!(matches!(
                check_claims_version(&pool, &claims_for(&sub, ver - 1)).await,
                Err(CapabilityError::StaleToken)
            ));
        }
    }
}
