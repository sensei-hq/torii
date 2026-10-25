//! [`PgJournal`] — `runs.journal_events` + `runs.run_snapshots` + the `runs.runs` format fence.

use orchestrator_core::{
    ExecutionJournal, FORMAT_VERSION, JournalError, JournalEvent, RunId, Seq, Snapshot,
};
use sqlx::PgPool;
use uuid::Uuid;

/// A transport error → the strict, surfaced journal error. Never swallowed.
fn pg_err(e: sqlx::Error) -> JournalError {
    JournalError::Backend(e.to_string())
}

/// A malformed journal payload is a backend fault, never silently dropped.
fn ser_err(e: serde_json::Error) -> JournalError {
    JournalError::Backend(e.to_string())
}

/// A durable, tenant-scoped [`ExecutionJournal`].
///
/// `append` stamps a monotonic `Seq` (the global identity `journal_events.seq`), `load`/
/// `load_since` return events in ascending `Seq`, snapshots are latest-wins, and `compact`
/// removes the named seqs and appends the manifest in one transaction. Every load checks the
/// run's persisted [`FORMAT_VERSION`] and fences with [`JournalError::IncompatibleFormat`] on a
/// mismatch — a journal written by an incompatible scheme halts resume rather than mis-folding.
#[derive(Clone)]
pub struct PgJournal {
    pool: PgPool,
    tenant: Uuid,
}

impl PgJournal {
    /// A journal for `tenant`'s runs over `pool` (see [`connect`](crate::connect)).
    pub fn new(pool: PgPool, tenant: Uuid) -> Self {
        Self { pool, tenant }
    }

    /// Fence: a run whose persisted `format_version` differs from this build's halts loudly.
    /// A run with no `runs` row (no `RunStarted` yet) is not fenced.
    async fn check_format(&self, run: RunId) -> Result<(), JournalError> {
        let row: Option<(i32,)> = sqlx::query_as(
            "select format_version from runs.runs where tenant_id = $1 and run_id = $2",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&self.pool)
        .await
        .map_err(pg_err)?;
        if let Some((stored,)) = row
            && stored != FORMAT_VERSION
        {
            return Err(JournalError::IncompatibleFormat {
                run,
                stored,
                expected: FORMAT_VERSION,
            });
        }
        Ok(())
    }

    fn decode(
        rows: Vec<(i64, serde_json::Value)>,
    ) -> Result<Vec<(Seq, JournalEvent)>, JournalError> {
        rows.into_iter()
            .map(|(s, v)| Ok((s as Seq, serde_json::from_value(v).map_err(ser_err)?)))
            .collect()
    }
}

#[async_trait::async_trait]
impl ExecutionJournal for PgJournal {
    async fn append(&self, run: RunId, event: JournalEvent) -> Result<Seq, JournalError> {
        let ev = serde_json::to_value(&event).map_err(ser_err)?;
        // Stamp the format version once per run (on the first RunStarted); idempotent.
        if matches!(event, JournalEvent::RunStarted { .. }) {
            sqlx::query(
                "insert into runs.runs (tenant_id, run_id, format_version) values ($1, $2, $3) \
                 on conflict (tenant_id, run_id) do nothing",
            )
            .bind(self.tenant)
            .bind(run.0)
            .bind(FORMAT_VERSION)
            .execute(&self.pool)
            .await
            .map_err(pg_err)?;
        }
        let (seq,): (i64,) = sqlx::query_as(
            "insert into runs.journal_events (tenant_id, run_id, event) values ($1, $2, $3) \
             returning seq",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(ev)
        .fetch_one(&self.pool)
        .await
        .map_err(pg_err)?;
        Ok(seq as Seq)
    }

    async fn load(&self, run: RunId) -> Result<Vec<(Seq, JournalEvent)>, JournalError> {
        self.check_format(run).await?;
        let rows = sqlx::query_as(
            "select seq, event from runs.journal_events \
             where tenant_id = $1 and run_id = $2 order by seq",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_all(&self.pool)
        .await
        .map_err(pg_err)?;
        Self::decode(rows)
    }

    async fn load_since(
        &self,
        run: RunId,
        since: Seq,
    ) -> Result<Vec<(Seq, JournalEvent)>, JournalError> {
        self.check_format(run).await?;
        let rows = sqlx::query_as(
            "select seq, event from runs.journal_events \
             where tenant_id = $1 and run_id = $2 and seq > $3 order by seq",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(since as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(pg_err)?;
        Self::decode(rows)
    }

    async fn snapshot(&self, run: RunId, snap: Snapshot) -> Result<(), JournalError> {
        let v = serde_json::to_value(&snap).map_err(ser_err)?;
        sqlx::query(
            "insert into runs.run_snapshots (tenant_id, run_id, seq, snapshot) \
             values ($1, $2, $3, $4) \
             on conflict (tenant_id, run_id) do update set \
             seq = excluded.seq, snapshot = excluded.snapshot, updated_at = now()",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(snap.seq as i64)
        .bind(v)
        .execute(&self.pool)
        .await
        .map_err(pg_err)?;
        Ok(())
    }

    async fn latest_snapshot(&self, run: RunId) -> Result<Option<Snapshot>, JournalError> {
        let row: Option<(serde_json::Value,)> = sqlx::query_as(
            "select snapshot from runs.run_snapshots where tenant_id = $1 and run_id = $2",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&self.pool)
        .await
        .map_err(pg_err)?;
        row.map(|(v,)| serde_json::from_value(v).map_err(ser_err))
            .transpose()
    }

    async fn compact(
        &self,
        run: RunId,
        remove_seqs: &[Seq],
        add: JournalEvent,
    ) -> Result<(), JournalError> {
        let ev = serde_json::to_value(&add).map_err(ser_err)?;
        let removes: Vec<i64> = remove_seqs.iter().map(|s| *s as i64).collect();
        // One transaction: drop the compacted events, then append the manifest (a fresh,
        // higher seq). The remaining events keep their ascending seq order.
        let mut tx = self.pool.begin().await.map_err(pg_err)?;
        sqlx::query(
            "delete from runs.journal_events \
             where tenant_id = $1 and run_id = $2 and seq = any($3)",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(&removes)
        .execute(&mut *tx)
        .await
        .map_err(pg_err)?;
        sqlx::query(
            "insert into runs.journal_events (tenant_id, run_id, event) values ($1, $2, $3)",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(ev)
        .execute(&mut *tx)
        .await
        .map_err(pg_err)?;
        tx.commit().await.map_err(pg_err)?;
        Ok(())
    }
}
