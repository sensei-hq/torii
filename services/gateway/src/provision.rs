//! DB auto-provision on startup via the `dbd-core` library (mirrors how the sensei daemon
//! provisions): fetch the schema from a GitHub ref → `apply` (DDL) → `import` (seed) → apply
//! RLS `policies`. Runs before the config loader queries the DB, so a fresh/empty prod Supabase
//! becomes usable on first boot instead of crash-looping on "relation catalog.routers not found".
//!
//! Enabled by `TORII_DB_SCHEMA_SOURCE` — a dbd source string `owner/repo/path[@ref]`
//! (e.g. `sensei-hq/torii/database@main`) or an absolute local directory. **Unset ⇒ skipped**
//! (the DB is assumed already provisioned, e.g. local dev / a managed migration flow).
//!
//! Guards: a Postgres **advisory lock** serializes concurrent machines; a fast pre-check skips
//! the (network) deploy when the catalog is already **seeded** (apply + import are separate
//! transactions, so it checks for seed rows, not just the table), keeping scale-to-zero cold
//! starts cheap and off the GitHub tarball API. **Fail-closed** — a provisioning error aborts
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

    // Fast path: already seeded → skip the network deploy (keeps cold starts cheap; apply schema
    // *changes* to an existing DB out of band, not on every boot).
    if catalog_seeded(pool).await? {
        tracing::info!(%source, "db provision: already seeded, skipping");
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
    let result = if catalog_seeded(pool).await.unwrap_or(false) {
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

/// True once the catalog is **seeded** — `catalog.routers` exists AND has rows. dbd runs apply
/// (schema) and import (seed) as SEPARATE transactions, so a created-but-empty table (apply
/// committed, import didn't) must NOT count as provisioned — else a failed import would be
/// skipped forever. Absent table OR zero rows ⇒ (re)provision (deploy is idempotent).
async fn catalog_seeded(pool: &PgPool) -> anyhow::Result<bool> {
    let exists: Option<String> = sqlx::query_scalar("select to_regclass('catalog.routers')::text")
        .fetch_one(pool)
        .await
        .context("db provision: catalog existence check")?;
    if exists.is_none() {
        return Ok(false);
    }
    let rows: i64 = sqlx::query_scalar("select count(*) from catalog.routers")
        .fetch_one(pool)
        .await
        .context("db provision: catalog seed check")?;
    Ok(rows > 0)
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

    // dbd deploy = apply (DDL) + import (seed) in one call. `None` scope = the full un-scoped
    // set (torii has no sensei-style scopes). dry_run = false.
    tracing::info!("db provision: dbd deploy (apply + import)");
    design
        .deploy(&adapter, false, None, |c| {
            tracing::info!(
                applied = c.apply.applied,
                created = c.apply.created,
                tables = c.import.tables,
                "db provision: deploy complete"
            );
        })
        .await
        .map_err(|e| anyhow!("db provision: deploy failed: {e}"))?;

    // RLS is a separate dbd step (its own CLI subcommand + library fn), required for the security
    // premise (secret tables deny-all + service_role-only). A failed policy is fatal.
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
