//! Tenant-scoped Postgres stores for the gateway orchestrator (TM-7, torii#25).
#![allow(unused)]
use chrono::{DateTime, Utc};
use orchestrator_core::{
    ConfigSource, ConfigStore, ContentStore, ContextKey, ContextRef, ContextStore, Digest,
    ExecutionJournal, Graph, JournalError, JournalEvent, OrchestratorError, RegistryConfig, RunId,
    RunLock, RunStatus, ScheduledRun, SchedulerStore, Scope, Seq, Snapshot,
};
use sqlx::postgres::{PgPool, PgPoolOptions};
use uuid::Uuid;

pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new().max_connections(8).connect(database_url).await
}

#[derive(Clone)]
pub struct PgJournal { pool: PgPool, tenant: Uuid }
impl PgJournal { pub fn new(pool: PgPool, tenant: Uuid) -> Self { Self { pool, tenant } } }
#[async_trait::async_trait]
impl ExecutionJournal for PgJournal {
    async fn append(&self, _: RunId, _: JournalEvent) -> Result<Seq, JournalError> { todo!() }
    async fn load(&self, _: RunId) -> Result<Vec<(Seq, JournalEvent)>, JournalError> { todo!() }
    async fn load_since(&self, _: RunId, _: Seq) -> Result<Vec<(Seq, JournalEvent)>, JournalError> { todo!() }
    async fn snapshot(&self, _: RunId, _: Snapshot) -> Result<(), JournalError> { todo!() }
    async fn latest_snapshot(&self, _: RunId) -> Result<Option<Snapshot>, JournalError> { todo!() }
    async fn compact(&self, _: RunId, _: &[Seq], _: JournalEvent) -> Result<(), JournalError> { todo!() }
}

#[derive(Clone)]
pub struct PgContentStore { pool: PgPool, tenant: Uuid }
impl PgContentStore { pub fn new(pool: PgPool, tenant: Uuid) -> Self { Self { pool, tenant } } }
#[async_trait::async_trait]
impl ContentStore for PgContentStore {
    async fn put(&self, _: &[u8]) -> Result<Digest, OrchestratorError> { todo!() }
    async fn get(&self, _: &Digest) -> Result<Vec<u8>, OrchestratorError> { todo!() }
}

#[derive(Clone)]
pub struct PgContextStore { pool: PgPool, tenant: Uuid }
impl PgContextStore { pub fn new(pool: PgPool, tenant: Uuid) -> Self { Self { pool, tenant } } }
#[async_trait::async_trait]
impl ContextStore for PgContextStore {
    async fn put(&self, _: RunId, _: Scope, _: ContextKey, _: serde_json::Value) -> Result<ContextRef, OrchestratorError> { todo!() }
    async fn get(&self, _: RunId, _: Scope, _: ContextKey) -> Result<Option<ContextRef>, OrchestratorError> { todo!() }
    async fn load(&self, _: &ContextRef) -> Result<serde_json::Value, OrchestratorError> { todo!() }
    async fn insert_ref(&self, _: RunId, _: ContextRef) -> Result<(), OrchestratorError> { todo!() }
}

#[derive(Clone)]
pub struct PgConfigStore { pool: PgPool, tenant: Uuid }
impl PgConfigStore { pub fn new(pool: PgPool, tenant: Uuid) -> Self { Self { pool, tenant } } }
#[async_trait::async_trait]
impl ConfigSource for PgConfigStore {
    async fn load(&self) -> Result<RegistryConfig, OrchestratorError> { todo!() }
}
#[async_trait::async_trait]
impl ConfigStore for PgConfigStore {
    async fn store_and_bump(&self, _: &RegistryConfig) -> Result<u64, OrchestratorError> { todo!() }
    async fn store_and_bump_if(&self, _: &RegistryConfig, _: u64) -> Result<Option<u64>, OrchestratorError> { todo!() }
}

pub struct PgSchedulerStore { pool: PgPool, tenant: Uuid }
impl PgSchedulerStore { pub fn new(pool: PgPool, tenant: Uuid) -> Self { Self { pool, tenant } } }
#[async_trait::async_trait]
impl SchedulerStore for PgSchedulerStore {
    async fn try_lock_run(&self, _: RunId) -> Result<Option<Box<dyn RunLock>>, OrchestratorError> { todo!() }
    async fn enqueue(&self, _: RunId, _: &Graph, _: DateTime<Utc>) -> Result<(), OrchestratorError> { todo!() }
    async fn record_paused(&self, _: RunId, _: Option<DateTime<Utc>>, _: &str) -> Result<(), OrchestratorError> { todo!() }
    async fn record_terminal(&self, _: RunId, _: RunStatus, _: Option<&str>) -> Result<(), OrchestratorError> { todo!() }
    async fn claim_due(&self, _: DateTime<Utc>, _: chrono::Duration, _: usize) -> Result<Vec<(RunId, Graph)>, OrchestratorError> { todo!() }
    async fn status(&self, _: RunId) -> Result<Option<ScheduledRun>, OrchestratorError> { todo!() }
    async fn list_paused(&self) -> Result<Vec<ScheduledRun>, OrchestratorError> { todo!() }
    async fn cancel(&self, _: RunId) -> Result<(), OrchestratorError> { todo!() }
    async fn force_wake(&self, _: RunId, _: DateTime<Utc>) -> Result<(), OrchestratorError> { todo!() }
    async fn count_terminal_before(&self, _: DateTime<Utc>) -> Result<u64, OrchestratorError> { todo!() }
    async fn prune_terminal(&self, _: DateTime<Utc>) -> Result<u64, OrchestratorError> { todo!() }
}
