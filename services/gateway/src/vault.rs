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

use crate::crypto::{generate_dek, seal_credential, seal_dek, unseal_credential, unseal_dek, Kek};

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

    /// Provision a per-tenant DEK if the tenant has none: generate a fresh 32-byte
    /// key, seal it under the KEK, insert `core.tenant_keys`. Idempotent — an
    /// existing row is never overwritten (that would orphan every credential sealed
    /// under the old DEK); `ON CONFLICT DO NOTHING` also guards the concurrent race.
    pub async fn ensure_tenant_dek(
        &self,
        pool: &PgPool,
        tenant_id: Uuid,
        actor: &str,
    ) -> anyhow::Result<()> {
        let dek = generate_dek();
        let sealed = seal_dek(&self.kek, &dek)?;
        sqlx::query(
            "insert into core.tenant_keys (tenant_id, encrypted_dek, dek_version, modified_by) \
             values ($1, $2, 1, $3) on conflict (tenant_id) do nothing",
        )
        .bind(tenant_id)
        .bind(sealed)
        .bind(actor)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Store (or rotate) the active `api_key` credential for `(tenant, router)`.
    /// The schema keeps **one row per `(tenant, router)`** (unique index), so
    /// "connect" inserts and "rotate" updates that same row in place — reactivating
    /// it if it had been revoked. Returns the row id. Auto-provisions the tenant DEK
    /// on first use. (Row history isn't kept here; the audit trail is `audit_events`
    /// + `modified_by`/`modified_at`.)
    pub async fn store_router_key(
        &self,
        pool: &PgPool,
        tenant_id: Uuid,
        router_id: Uuid,
        label: Option<&str>,
        plaintext: &str,
        actor: &str,
    ) -> anyhow::Result<Uuid> {
        self.ensure_tenant_dek(pool, tenant_id, actor).await?;
        let dek = self.tenant_dek(pool, tenant_id).await?;
        let sealed = seal_credential(&dek, plaintext.as_bytes())?;

        let id: Uuid = sqlx::query_scalar(
            "insert into public.router_keys \
               (tenant_id, id, router_id, encrypted_api_key, key_label, is_active, \
                credential_type, modified_by) \
             values ($1, gen_random_uuid(), $2, $3, $4, true, 'api_key', $5) \
             on conflict (tenant_id, router_id) do update set \
               encrypted_api_key = excluded.encrypted_api_key, \
               key_label = excluded.key_label, \
               is_active = true, \
               credential_type = 'api_key', \
               modified_by = excluded.modified_by \
             returning id",
        )
        .bind(tenant_id)
        .bind(router_id)
        .bind(sealed)
        .bind(label)
        .bind(actor)
        .fetch_one(pool)
        .await?;
        Ok(id)
    }

    /// Deactivate the active `api_key` credential for `(tenant, router)`. Resolution
    /// then stops serving it (the caller falls back to the platform key or fails).
    pub async fn revoke_router_key(
        &self,
        pool: &PgPool,
        tenant_id: Uuid,
        router_id: Uuid,
        actor: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "update public.router_keys set is_active = false, modified_by = $3 \
             where tenant_id = $1 and router_id = $2 \
               and credential_type = 'api_key' and is_active = true",
        )
        .bind(tenant_id)
        .bind(router_id)
        .bind(actor)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Decrypt every active `api_key` credential for the tenant into a
    /// `router_name → key` map (router name is what the engine matches on). Empty
    /// when none are stored. The tenant DEK is resolved once, only if rows exist.
    pub async fn resolve_tenant_keys(
        &self,
        pool: &PgPool,
        tenant_id: Uuid,
    ) -> anyhow::Result<std::collections::HashMap<String, String>> {
        let rows = sqlx::query(
            "select r.name as name, k.encrypted_api_key as enc \
             from public.router_keys k \
             join config.routers r on r.id = k.router_id \
             where k.tenant_id = $1 and k.is_active = true and k.credential_type = 'api_key'",
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await?;

        let mut out = std::collections::HashMap::new();
        if rows.is_empty() {
            return Ok(out);
        }
        let dek = self.tenant_dek(pool, tenant_id).await?;
        for row in rows {
            let name: String = row.try_get("name")?;
            let enc: Vec<u8> = row.try_get("enc")?;
            let key = unseal_credential(&dek, &enc)?;
            out.insert(name, key.to_string());
        }
        Ok(out)
    }
}

#[cfg(test)]
impl Vault {
    /// Test-only constructor with a fixed KEK (no env dependency).
    fn with_kek(kek: Kek) -> Self {
        Self { kek }
    }
}

#[cfg(test)]
mod integration {
    //! Hits the local Supabase DB (55322). Ignored by default — run with:
    //!   `cargo test -p torii-gateway -- --ignored vault_lifecycle`
    use super::*;
    use crate::crypto::Kek;
    use sqlx::postgres::PgPoolOptions;

    async fn pool() -> PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn vault_lifecycle_store_resolve_rotate_revoke() {
        let pool = pool().await;
        let vault = Vault::with_kek(Kek::from_bytes([9u8; 32]));
        let tenant = Uuid::new_v4();
        let router_id: Uuid =
            sqlx::query_scalar("select id from config.routers where name = 'openai'")
                .fetch_one(&pool)
                .await
                .expect("openai router seeded");

        // temp tenant (FK target) — cleaned up at the end.
        sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) \
             values ($1, 'vault-test', $2, 'vault-test')",
        )
        .bind(tenant)
        .bind(format!("vault-test-{tenant}"))
        .execute(&pool)
        .await
        .expect("insert temp tenant");

        // 1. store auto-provisions the DEK + persists a sealed active row.
        let id1 = vault
            .store_router_key(
                &pool,
                tenant,
                router_id,
                Some("byok"),
                "sk-test-AAA",
                "tester",
            )
            .await
            .unwrap();
        let dek_rows: i64 =
            sqlx::query_scalar("select count(*) from core.tenant_keys where tenant_id = $1")
                .bind(tenant)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(dek_rows, 1, "DEK auto-provisioned on first store");

        // 2. resolve returns the plaintext keyed by router NAME.
        let keys = vault.resolve_tenant_keys(&pool, tenant).await.unwrap();
        assert_eq!(keys.get("openai").map(String::as_str), Some("sk-test-AAA"));

        // 3. rotate (store again) → exactly one active row, new value.
        let id2 = vault
            .store_router_key(
                &pool,
                tenant,
                router_id,
                Some("byok"),
                "sk-test-BBB",
                "tester",
            )
            .await
            .unwrap();
        assert_eq!(
            id1, id2,
            "rotate updates the same (tenant, router) row in place"
        );
        let active: i64 = sqlx::query_scalar(
            "select count(*) from public.router_keys \
             where tenant_id = $1 and router_id = $2 and is_active",
        )
        .bind(tenant)
        .bind(router_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(active, 1, "exactly one active row after rotate");
        assert_eq!(
            vault
                .resolve_tenant_keys(&pool, tenant)
                .await
                .unwrap()
                .get("openai")
                .map(String::as_str),
            Some("sk-test-BBB")
        );

        // 4. revoke → resolve omits it.
        vault
            .revoke_router_key(&pool, tenant, router_id, "tester")
            .await
            .unwrap();
        assert!(!vault
            .resolve_tenant_keys(&pool, tenant)
            .await
            .unwrap()
            .contains_key("openai"));

        // cleanup (order respects FKs).
        for stmt in [
            "delete from public.router_keys where tenant_id = $1",
            "delete from core.tenant_keys where tenant_id = $1",
            "delete from core.tenants where id = $1",
        ] {
            sqlx::query(stmt).bind(tenant).execute(&pool).await.unwrap();
        }
    }
}
