//! [`PgContentStore`] (`runs.cas_blobs`) and [`PgContextStore`] (`runs.context_refs`).

use orchestrator_core::{
    ContentRef, ContentStore, ContextKey, ContextRef, ContextStore, Digest, OrchestratorError,
    RunId, Scope, digest_of,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::store_err;

/// True for a Postgres UNIQUE / primary-key violation (SQLSTATE 23505).
fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.as_database_error()
        .map(|d| d.is_unique_violation())
        .unwrap_or(false)
}

/// The scope label a `ContextKeyCollision` carries — byte-for-byte parity with the in-memory
/// store (`"Run"` / `"Node(<id>)"`).
fn scope_label(scope: &Scope) -> String {
    match scope {
        Scope::Run => "Run".to_string(),
        Scope::Node(n) => format!("Node({})", n.0),
    }
}

/// A durable, tenant-scoped [`ContentStore`].
///
/// `put` is content-addressed and idempotent (identical bytes → the same [`Digest`] and one row
/// per tenant); `get` is strict — a miss is a loud
/// [`ContentDigestMiss`](OrchestratorError::ContentDigestMiss), never empty bytes. The CAS is per
/// tenant: a digest another tenant stored is a miss here, so a digest can never be used to read
/// another tenant's bytes.
#[derive(Clone)]
pub struct PgContentStore {
    pool: PgPool,
    tenant: Uuid,
}

impl PgContentStore {
    /// A CAS for `tenant` over `pool` (see [`connect`](crate::connect)).
    pub fn new(pool: PgPool, tenant: Uuid) -> Self {
        Self { pool, tenant }
    }
}

#[async_trait::async_trait]
impl ContentStore for PgContentStore {
    async fn put(&self, bytes: &[u8]) -> Result<Digest, OrchestratorError> {
        let digest = digest_of(bytes);
        sqlx::query(
            "insert into runs.cas_blobs (tenant_id, digest, bytes) values ($1, $2, $3) \
             on conflict (tenant_id, digest) do nothing",
        )
        .bind(self.tenant)
        .bind(&digest.0)
        .bind(bytes)
        .execute(&self.pool)
        .await
        .map_err(store_err)?;
        Ok(digest)
    }

    async fn get(&self, digest: &Digest) -> Result<Vec<u8>, OrchestratorError> {
        let row: Option<(Vec<u8>,)> =
            sqlx::query_as("select bytes from runs.cas_blobs where tenant_id = $1 and digest = $2")
                .bind(self.tenant)
                .bind(&digest.0)
                .fetch_optional(&self.pool)
                .await
                .map_err(store_err)?;
        row.map(|(b,)| b)
            .ok_or_else(|| OrchestratorError::ContentDigestMiss(digest.0.clone()))
    }
}

/// A durable, tenant-scoped [`ContextStore`] keyed by `(run_id, scope_kind, scope_id, ctx_key)`,
/// each value's bytes stored once in the tenant's CAS.
///
/// `run_id` is load-bearing (gateway SP-OPS-1.1): without it a `Scope::Run` row is global, and a
/// re-run of the same graph collides on its first completed node. `put` rejects a re-write of an
/// existing `(run, scope, key)` LOUDLY with
/// [`ContextKeyCollision`](OrchestratorError::ContextKeyCollision); `get` resolves `Node` → `Run`
/// within the run and misses as `Ok(None)`; `insert_ref` rehydrates a journaled write
/// idempotently.
#[derive(Clone)]
pub struct PgContextStore {
    pool: PgPool,
    tenant: Uuid,
}

impl PgContextStore {
    /// A blackboard for `tenant` over `pool` (see [`connect`](crate::connect)).
    pub fn new(pool: PgPool, tenant: Uuid) -> Self {
        Self { pool, tenant }
    }

    /// `(scope_kind, scope_id)`: `Run` carries an empty id, `Node(id)` the node path. The run
    /// is its own column — [`Scope`] is journaled and must keep its encoding.
    fn scope_cols(scope: &Scope) -> (&'static str, String) {
        match scope {
            Scope::Run => ("run", String::new()),
            Scope::Node(n) => ("node", n.0.clone()),
        }
    }

    /// The same tenant's CAS over the same pool.
    fn cas(&self) -> PgContentStore {
        PgContentStore::new(self.pool.clone(), self.tenant)
    }

    async fn fetch(
        &self,
        run: RunId,
        kind: &str,
        id: &str,
        key: &str,
    ) -> Result<Option<ContextRef>, OrchestratorError> {
        let row: Option<(serde_json::Value,)> = sqlx::query_as(
            "select ctx_ref from runs.context_refs \
             where tenant_id = $1 and run_id = $2 and scope_kind = $3 and scope_id = $4 \
               and ctx_key = $5",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(kind)
        .bind(id)
        .bind(key)
        .fetch_optional(&self.pool)
        .await
        .map_err(store_err)?;
        row.map(|(v,)| serde_json::from_value(v).map_err(OrchestratorError::from))
            .transpose()
    }
}

#[async_trait::async_trait]
impl ContextStore for PgContextStore {
    async fn put(
        &self,
        run: RunId,
        scope: Scope,
        key: ContextKey,
        value: serde_json::Value,
    ) -> Result<ContextRef, OrchestratorError> {
        // Bytes first (idempotent CAS), then the ref.
        let bytes = serde_json::to_vec(&value)?;
        let digest = self.cas().put(&bytes).await?;
        let context_ref = ContextRef {
            key: key.clone(),
            scope: scope.clone(),
            content: ContentRef {
                digest,
                size: bytes.len(),
                summary: None,
            },
            summary: None,
        };
        let (kind, id) = Self::scope_cols(&scope);
        let ref_json = serde_json::to_value(&context_ref)?;
        // A plain insert, never `on conflict do nothing`: a duplicate within one run is a loud
        // collision, not a silent overwrite.
        let res = sqlx::query(
            "insert into runs.context_refs \
             (tenant_id, run_id, scope_kind, scope_id, ctx_key, ctx_ref) \
             values ($1, $2, $3, $4, $5, $6)",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(kind)
        .bind(&id)
        .bind(&key.0)
        .bind(ref_json)
        .execute(&self.pool)
        .await;
        match res {
            Ok(_) => Ok(context_ref),
            Err(e) if is_unique_violation(&e) => Err(OrchestratorError::ContextKeyCollision {
                scope: scope_label(&scope),
                key: key.0,
            }),
            Err(e) => Err(store_err(e)),
        }
    }

    async fn get(
        &self,
        run: RunId,
        scope: Scope,
        key: ContextKey,
    ) -> Result<Option<ContextRef>, OrchestratorError> {
        let (kind, id) = Self::scope_cols(&scope);
        if let Some(found) = self.fetch(run, kind, &id, &key.0).await? {
            return Ok(Some(found));
        }
        // A Node read falls back to the Run-scoped entry OF THE SAME RUN.
        if let Scope::Node(_) = scope {
            let (rk, rid) = Self::scope_cols(&Scope::Run);
            if let Some(found) = self.fetch(run, rk, &rid, &key.0).await? {
                return Ok(Some(found));
            }
        }
        Ok(None)
    }

    async fn load(&self, r: &ContextRef) -> Result<serde_json::Value, OrchestratorError> {
        let bytes = self.cas().get(&r.content.digest).await?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn insert_ref(&self, run: RunId, r: ContextRef) -> Result<(), OrchestratorError> {
        // Rehydration from a journaled write: idempotent, no collision check (the journal is the
        // source of truth), no CAS touch. First-write-wins vs the in-memory last-write-wins is
        // immaterial: `put` enforces collisions at journal-write time, so a fold only replays an
        // identical ref for a given `(run, scope, key)`.
        let (kind, id) = Self::scope_cols(&r.scope);
        let ref_json = serde_json::to_value(&r)?;
        sqlx::query(
            "insert into runs.context_refs \
             (tenant_id, run_id, scope_kind, scope_id, ctx_key, ctx_ref) \
             values ($1, $2, $3, $4, $5, $6) \
             on conflict (tenant_id, run_id, scope_kind, scope_id, ctx_key) do nothing",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(kind)
        .bind(&id)
        .bind(&r.key.0)
        .bind(ref_json)
        .execute(&self.pool)
        .await
        .map_err(store_err)?;
        Ok(())
    }
}
