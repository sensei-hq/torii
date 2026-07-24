//! F2 · server-side capability resolution + the claims-version freshness gate.
//!
//! The JWT carries only `tenant_id` + `role_ids[]` + `claims_version` (F2 §4.1).
//! C1 resolves the effective capability set from `core.role_permissions` for those
//! role ids — the token is NEVER trusted for capabilities. Every privileged
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
        let rows = sqlx::query(
            "select distinct capability from core.role_permissions \
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
    let current: Option<i64> =
        sqlx::query_scalar("select claims_version from core.profiles where id = $1")
            .bind(uid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    match current {
        Some(v) if v > claims.claims_version => Err(CapabilityError::StaleToken),
        _ => Ok(()),
    }
}
