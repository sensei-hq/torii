//! [`PgConfigStore`] — the registry (`registry.agents|skills|tools|chain_bindings`) and its
//! per-tenant generation (`config.config_versions`' `registry` component, via
//! `registry.generation` / `registry.bump_generation`).

use orchestrator_core::{
    ChainBinding, ConfigSource, ConfigStore, OrchestratorError, RegistryConfig,
};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{store_err, store_err_ser};

/// A config LOAD-path failure → `RegistryLoad` (the `ConfigSource` convention).
fn cfg_load_err(e: sqlx::Error) -> OrchestratorError {
    OrchestratorError::RegistryLoad(format!("postgres config load: {e}"))
}

fn decode<T: serde::de::DeserializeOwned>(
    what: &str,
    rows: Vec<(String, serde_json::Value)>,
) -> Result<Vec<T>, OrchestratorError> {
    rows.into_iter()
        .map(|(n, v)| {
            serde_json::from_value(v)
                .map_err(|e| OrchestratorError::RegistryLoad(format!("deser {what} {n}: {e}")))
        })
        .collect()
}

/// A durable, tenant-scoped `ConfigSource` + `ConfigStore`.
///
/// The (config, generation) pair is only safe when both sides move together, so there is one
/// atomic reader and one atomic writer:
/// - [`load_versioned`](ConfigSource::load_versioned) reads the four registry tables AND the
///   generation in ONE `REPEATABLE READ` transaction, so a concurrent publish lands wholly
///   before or wholly after it — never a torn (stale config, fresh generation) pair.
/// - [`store_and_bump_if`](ConfigStore::store_and_bump_if) bumps the generation (a
///   compare-and-swap against the caller's expectation) and replaces the registry in ONE
///   transaction. `store_and_bump` is its unconditional sibling.
///
/// **Bump first.** `registry.bump_generation` takes a per-tenant transaction-scoped advisory
/// lock, so the bump is what serializes concurrent publishers: a second writer blocks there
/// until the first COMMITS, and its replace-all `DELETE` then runs on a statement snapshot that
/// sees — and removes — the first writer's rows. True last-writer-wins. With the bump last, the
/// loser's `DELETE` would snapshot before the winner committed and the two configs would merge
/// (or deadlock, or fail `23505`, depending on how their names overlap — gateway SP-DATA-4).
/// For the CAS, the lock is also what makes "read the generation, compare, bump" one step.
///
/// The generation is per tenant and is the `registry` component of the tenant's
/// `config.config_versions` row, so a catalog or routing edit never moves it (no paused run is
/// stranded by an unrelated edit), while a publish still advances the overall config version.
#[derive(Clone)]
pub struct PgConfigStore {
    pool: PgPool,
    tenant: Uuid,
}

impl PgConfigStore {
    /// The registry of `tenant` over `pool` (see [`connect`](crate::connect)).
    pub fn new(pool: PgPool, tenant: Uuid) -> Self {
        Self { pool, tenant }
    }

    /// Read the whole registry over ONE connection; the caller chooses the snapshot semantics.
    /// Order matters to a test: agents, skills, tools, chain bindings.
    async fn read_all(&self, conn: &mut PgConnection) -> Result<RegistryConfig, OrchestratorError> {
        let agents: Vec<(String, serde_json::Value)> = sqlx::query_as(
            "select name, def from registry.agents where tenant_id = $1 order by name",
        )
        .bind(self.tenant)
        .fetch_all(&mut *conn)
        .await
        .map_err(cfg_load_err)?;
        let skills: Vec<(String, serde_json::Value)> = sqlx::query_as(
            "select name, def from registry.skills where tenant_id = $1 order by name",
        )
        .bind(self.tenant)
        .fetch_all(&mut *conn)
        .await
        .map_err(cfg_load_err)?;
        let tools: Vec<(String, serde_json::Value)> = sqlx::query_as(
            "select name, spec from registry.tools where tenant_id = $1 order by name",
        )
        .bind(self.tenant)
        .fetch_all(&mut *conn)
        .await
        .map_err(cfg_load_err)?;
        let bindings: Vec<(String, String, String)> = sqlx::query_as(
            "select area, kind, chain from registry.chain_bindings where tenant_id = $1 \
             order by area, kind",
        )
        .bind(self.tenant)
        .fetch_all(&mut *conn)
        .await
        .map_err(cfg_load_err)?;
        Ok(RegistryConfig {
            agents: decode("agent", agents)?,
            skills: decode("skill", skills)?,
            tools: decode("tool", tools)?,
            chain_bindings: bindings
                .into_iter()
                .map(|(area, kind, chain)| ChainBinding { area, kind, chain })
                .collect(),
        })
    }

    /// Replace-all write of the tenant's registry, on the caller's transaction.
    async fn write_all(
        &self,
        conn: &mut PgConnection,
        cfg: &RegistryConfig,
    ) -> Result<(), OrchestratorError> {
        for t in [
            "registry.agents",
            "registry.skills",
            "registry.tools",
            "registry.chain_bindings",
        ] {
            sqlx::query(&format!("delete from {t} where tenant_id = $1"))
                .bind(self.tenant)
                .execute(&mut *conn)
                .await
                .map_err(store_err)?;
        }
        for a in &cfg.agents {
            let v = serde_json::to_value(a).map_err(store_err_ser)?;
            sqlx::query("insert into registry.agents (tenant_id, name, def) values ($1, $2, $3)")
                .bind(self.tenant)
                .bind(&a.name)
                .bind(v)
                .execute(&mut *conn)
                .await
                .map_err(store_err)?;
        }
        for s in &cfg.skills {
            let v = serde_json::to_value(s).map_err(store_err_ser)?;
            sqlx::query("insert into registry.skills (tenant_id, name, def) values ($1, $2, $3)")
                .bind(self.tenant)
                .bind(&s.name)
                .bind(v)
                .execute(&mut *conn)
                .await
                .map_err(store_err)?;
        }
        for t in &cfg.tools {
            let v = serde_json::to_value(t).map_err(store_err_ser)?;
            sqlx::query("insert into registry.tools (tenant_id, name, spec) values ($1, $2, $3)")
                .bind(self.tenant)
                .bind(&t.name)
                .bind(v)
                .execute(&mut *conn)
                .await
                .map_err(store_err)?;
        }
        for b in &cfg.chain_bindings {
            sqlx::query(
                "insert into registry.chain_bindings (tenant_id, area, kind, chain) \
                 values ($1, $2, $3, $4)",
            )
            .bind(self.tenant)
            .bind(&b.area)
            .bind(&b.kind)
            .bind(&b.chain)
            .execute(&mut *conn)
            .await
            .map_err(store_err)?;
        }
        Ok(())
    }

    /// The tenant's generation (0 before the first publish), on `conn`'s snapshot.
    async fn generation_on(&self, conn: &mut PgConnection) -> Result<u64, OrchestratorError> {
        let (g,): (i64,) = sqlx::query_as("select registry.generation($1)")
            .bind(self.tenant)
            .fetch_one(&mut *conn)
            .await
            .map_err(store_err)?;
        Ok(g as u64)
    }
}

#[async_trait::async_trait]
impl ConfigStore for PgConfigStore {
    /// Replace the registry AND advance the generation in ONE transaction, unconditionally.
    /// Production publishers use [`store_and_bump_if`](Self::store_and_bump_if).
    async fn store_and_bump(&self, cfg: &RegistryConfig) -> Result<u64, OrchestratorError> {
        let mut tx = self.pool.begin().await.map_err(store_err)?;
        let (v,): (i64,) = sqlx::query_as("select registry.bump_generation($1, null)")
            .bind(self.tenant)
            .fetch_one(&mut *tx)
            .await
            .map_err(store_err)?;
        self.write_all(&mut tx, cfg).await?;
        tx.commit().await.map_err(store_err)?;
        Ok(v as u64)
    }

    /// Replace the registry AND advance the generation, ONLY if the generation is still
    /// `expected`. `Ok(None)` = it moved; nothing is written (the transaction rolls back).
    ///
    /// The compare happens inside `registry.bump_generation`, under the per-tenant lock, so
    /// there is no window between the check and the write. A tenant with no
    /// `config_versions` row, or one created by another component, is at generation 0 — so a
    /// genuine first push at 0 lands rather than reporting a false miss.
    async fn store_and_bump_if(
        &self,
        cfg: &RegistryConfig,
        expected: u64,
    ) -> Result<Option<u64>, OrchestratorError> {
        let mut tx = self.pool.begin().await.map_err(store_err)?;
        let (v,): (Option<i64>,) = sqlx::query_as("select registry.bump_generation($1, $2)")
            .bind(self.tenant)
            .bind(expected as i64)
            .fetch_one(&mut *tx)
            .await
            .map_err(store_err)?;
        let Some(v) = v else {
            return Ok(None); // dropping `tx` rolls back
        };
        self.write_all(&mut tx, cfg).await?;
        tx.commit().await.map_err(store_err)?;
        Ok(Some(v as u64))
    }
}

#[async_trait::async_trait]
impl ConfigSource for PgConfigStore {
    /// The unversioned read — one connection, per-statement snapshots. Callers that need the
    /// (config, generation) pair use `load_versioned`.
    async fn load(&self) -> Result<RegistryConfig, OrchestratorError> {
        let mut conn = self.pool.acquire().await.map_err(store_err)?;
        self.read_all(&mut conn).await
    }

    /// Always `Some` — a versioned source; 0 before the first publish.
    async fn version(&self) -> Result<Option<u64>, OrchestratorError> {
        let mut conn = self.pool.acquire().await.map_err(store_err)?;
        Ok(Some(self.generation_on(&mut conn).await?))
    }

    /// ONE `REPEATABLE READ` snapshot over the registry tables AND the generation.
    async fn load_versioned(&self) -> Result<(RegistryConfig, Option<u64>), OrchestratorError> {
        let mut tx = self.pool.begin().await.map_err(store_err)?;
        sqlx::query("set transaction isolation level repeatable read")
            .execute(&mut *tx)
            .await
            .map_err(store_err)?;
        let cfg = self.read_all(&mut tx).await?;
        let g = self.generation_on(&mut tx).await?;
        tx.commit().await.map_err(store_err)?;
        Ok((cfg, Some(g)))
    }
}
