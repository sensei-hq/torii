//! DB auto-provision on startup via the `dbd-core` library (mirrors how the sensei daemon
//! provisions): fetch the schema from a GitHub ref → `apply` (DDL) → `import` (seed) → apply
//! RLS `policies`. Runs before the config loader queries the DB, so a fresh/empty prod Supabase
//! becomes usable on first boot instead of crash-looping on "relation config.routers not found".
//!
//! Enabled by `TORII_DB_SCHEMA_SOURCE` — a dbd source string `owner/repo/path[@ref]`
//! (e.g. `sensei-hq/torii/database@main`) or an absolute local directory. **Unset ⇒ skipped**
//! (the DB is assumed already provisioned, e.g. local dev / a managed migration flow).
//!
//! Guards: a Postgres **advisory lock** serializes concurrent machines; a fast pre-check skips
//! the (network) deploy when the catalog already exists, so scale-to-zero cold starts stay cheap
//! and don't hammer the GitHub tarball API. **Fail-closed** — a provisioning error aborts
//! startup rather than serving a half-built database.

use anyhow::{anyhow, Context};
use sqlx::PgPool;

use dbd_core::adapter::postgres::PostgresAdapter;
use dbd_core::{deploy::resolve_source, Design};

/// Advisory-lock key (arbitrary, gateway-wide) so only one machine provisions at a time.
const PROVISION_LOCK_KEY: i64 = 0x_746F_7269_6900; // "torii\0"

/// Provision the DB if `TORII_DB_SCHEMA_SOURCE` is set and the catalog is absent. No-op otherwise.
pub async fn maybe_provision(pool: &PgPool, db_url: &str) -> anyhow::Result<()> {
    let Ok(source) = std::env::var("TORII_DB_SCHEMA_SOURCE") else {
        return Ok(());
    };
    let source = source.trim().to_string();
    if source.is_empty() {
        return Ok(());
    }

    // Fast path: catalog already present → skip the network deploy (keeps cold starts cheap;
    // apply schema *changes* to an existing DB out of band, not on every boot).
    if catalog_present(pool).await? {
        tracing::info!(%source, "db provision: schema present, skipping");
        return Ok(());
    }

    tracing::info!(%source, "db provision: schema absent — starting dbd deploy");
    // Serialize across machines: hold a session advisory lock for the whole deploy.
    let mut lock = pool
        .acquire()
        .await
        .context("db provision: acquire advisory-lock connection")?;
    sqlx::query("select pg_advisory_lock($1)")
        .bind(PROVISION_LOCK_KEY)
        .execute(&mut *lock)
        .await
        .context("db provision: pg_advisory_lock")?;

    // Re-check under the lock: another machine may have provisioned while we waited.
    let result = if catalog_present(pool).await.unwrap_or(false) {
        tracing::info!("db provision: another machine provisioned while we waited; skipping");
        Ok(())
    } else {
        deploy(db_url, &source).await
    };

    // Release (dropping the connection would also release session locks, but be explicit).
    let _ = sqlx::query("select pg_advisory_unlock($1)")
        .bind(PROVISION_LOCK_KEY)
        .execute(&mut *lock)
        .await;
    result
}

/// True once the seed catalog (`config.routers`) exists — the gateway's boot-time query target.
async fn catalog_present(pool: &PgPool) -> anyhow::Result<bool> {
    let reg: Option<String> = sqlx::query_scalar("select to_regclass('config.routers')::text")
        .fetch_one(pool)
        .await
        .context("db provision: catalog precheck")?;
    Ok(reg.is_some())
}

/// `dbd deploy`: resolve the source (GitHub tarball or local dir) → apply DDL → import seed →
/// apply RLS policies. Idempotent (dbd tracks applied state). Mirrors sensei's bootstrap deploy.
async fn deploy(db_url: &str, source: &str) -> anyhow::Result<()> {
    let project_dir = resolve_source(source)
        .await
        .map_err(|e| anyhow!("db provision: source `{source}` resolution failed: {e}"))?;
    let config_path = project_dir.join("design.yaml");
    let design = Design::from_config_with_dir(&config_path, "prod", Some(&project_dir))
        .map_err(|e| anyhow!("db provision: config load failed: {e}"))?;
    let adapter = PostgresAdapter::new(db_url, "torii")
        .await
        .map_err(|e| anyhow!("db provision: database connection failed: {e}"))?;

    // torii runs a single un-scoped schema (no sensei-style scopes) → apply/import everything
    // by passing `None` for the scope filter.
    tracing::info!("db provision: apply (DDL)");
    design
        .apply(
            &adapter,
            None,
            false,
            None,
            |desc: &str| tracing::debug!(step = "apply", desc, "starting"),
            |desc: &str, err: Option<&str>| {
                if let Some(e) = err {
                    tracing::warn!(step = "apply", desc, error = e, "failed");
                }
            },
            |_summary| tracing::info!("db provision: apply complete"),
        )
        .await
        .map_err(|e| anyhow!("db provision: apply failed: {e}"))?;

    tracing::info!("db provision: import (seed)");
    design
        .import_data(
            &adapter,
            None,
            false,
            None,
            |desc: &str| tracing::debug!(step = "import", desc, "starting"),
            |desc: &str, err: Option<&str>| {
                if let Some(e) = err {
                    tracing::warn!(step = "import", desc, error = e, "failed");
                }
            },
            |_summary| tracing::info!("db provision: import complete"),
        )
        .await
        .map_err(|e| anyhow!("db provision: import failed: {e}"))?;

    // RLS is the security premise (secret tables deny-all + service_role). A failed policy is fatal.
    tracing::info!("db provision: policies (RLS)");
    let report = dbd_core::design::apply_policies(&adapter, &project_dir, false)
        .await
        .map_err(|e| anyhow!("db provision: policies failed: {e}"))?;
    if !report.failed.is_empty() {
        return Err(anyhow!(
            "db provision: {} RLS policy file(s) failed: {:?}",
            report.failed.len(),
            report.failed
        ));
    }
    tracing::info!(applied = report.applied.len(), "db provision: complete");
    Ok(())
}
