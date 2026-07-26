//! F3 credential vault — DB-backed resolution of provider credentials.
//!
//! Reads the per-tenant DEK from `core.tenant_keys` (sealed by the KEK), then
//! decrypts a provider credential from `public.router_keys` (sealed by the DEK).
//! All decryption happens here in the gateway (`service_role`); a decrypted key
//! is returned to the caller for immediate use and never persisted or logged.
//!
//! This replaces the `keys::env_key_resolver` plaintext-env shim (DECISIONS §2 W4:
//! F3 vault before any real provider credential). OAuth credentials (type=oauth)
//! decrypt the same way; their refresh worker is F3-central and depends on the
//! cloud-adapter OAuth support (gateway issue GH-2, #36).

use sqlx::{PgPool, Row};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::{unseal_credential, unseal_dek, Kek};

// P5 (C1 hardening) wires the vault into the per-request key-injection path;
// the resolver methods are exercised there. Kept warning-free until then.
#[allow(dead_code)]
pub struct Vault {
    kek: Kek,
}

#[allow(dead_code)]

impl Vault {
    /// Build from the environment KEK (dev). Production: a KMS-backed KEK.
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            kek: Kek::from_env()?,
        })
    }

    /// Resolve + decrypt a tenant's data-encryption key. Held in `Zeroizing` so the
    /// key material is wiped from memory when the caller drops it.
    async fn tenant_dek(
        &self,
        pool: &PgPool,
        tenant_id: Uuid,
    ) -> anyhow::Result<Zeroizing<[u8; 32]>> {
        let row = sqlx::query("select encrypted_dek from core.tenant_keys where tenant_id = $1")
            .bind(tenant_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("no tenant_keys row for tenant {tenant_id}"))?;
        let enc: Vec<u8> = row.try_get("encrypted_dek")?;
        Ok(unseal_dek(&self.kek, &enc)?)
    }

    /// Resolve + decrypt the active provider api_key for `(tenant, router)`.
    /// Returns `None` when no credential is stored (caller falls back / errors).
    pub async fn resolve_router_key(
        &self,
        pool: &PgPool,
        tenant_id: Uuid,
        router_id: Uuid,
    ) -> anyhow::Result<Option<Zeroizing<String>>> {
        let row = sqlx::query(
            "select encrypted_api_key from public.router_keys \
             where tenant_id = $1 and router_id = $2 and is_active = true \
               and credential_type = 'api_key'",
        )
        .bind(tenant_id)
        .bind(router_id)
        .fetch_optional(pool)
        .await?;

        match row {
            None => Ok(None),
            Some(r) => {
                let dek = self.tenant_dek(pool, tenant_id).await?;
                let enc: Vec<u8> = r.try_get("encrypted_api_key")?;
                Ok(Some(unseal_credential(&dek, &enc)?))
            }
        }
    }
}
