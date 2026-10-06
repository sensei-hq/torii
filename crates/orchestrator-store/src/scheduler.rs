//! [`PgSchedulerStore`] — `runs.scheduled_runs` + the per-run drive lock.

use chrono::{DateTime, Utc};
use orchestrator_core::{
    Graph, OrchestratorError, RunId, RunLock, RunStatus, ScheduledRun, SchedulerStore,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{store_err, store_err_ser};

/// A durable, tenant-scoped [`SchedulerStore`]: one row per submitted run holding its ORIGINAL
/// graph + status/schedule. `claim_due` locks the due set once (`FOR UPDATE SKIP LOCKED` in a
/// materialized CTE) and updates it in the same statement, so concurrent claimers never overlap;
/// the row lock is held only for the claim, not the drive. Every sweep covers THIS tenant only.
pub struct PgSchedulerStore {
    pool: PgPool,
    tenant: Uuid,
}

impl PgSchedulerStore {
    /// The schedule of `tenant` over `pool` (see [`connect`](crate::connect)).
    pub fn new(pool: PgPool, tenant: Uuid) -> Self {
        Self { pool, tenant }
    }
}

/// Fold a 128-bit id into 64 bits.
fn fold(id: Uuid) -> u64 {
    let bits = id.as_u128();
    (bits >> 64) as u64 ^ (bits as u64)
}

/// The `bigint` a run's advisory lock is keyed by: the run AND the tenant, so the same run id
/// in two tenants (two different runs — the key is `(tenant_id, run_id)`) never blocks the
/// other's drive. Lossy by construction; a collision makes two different runs mutually
/// exclusive — a liveness cost (a skipped tick), never a double drive.
fn advisory_key(tenant: Uuid, run: RunId) -> i64 {
    (fold(run.0) ^ fold(tenant)) as i64
}

/// A held session advisory lock on a **detached** connection. An advisory lock lives as long
/// as its session, and a pooled connection returned to the pool keeps its session — the lock
/// would survive invisibly and be inherited by an unrelated query. Dropping a detached
/// connection closes the session, so a panicking drive that skips `release` still frees the
/// run, and a killed worker's locks are reaped with its TCP connection.
struct PgRunLock {
    conn: Option<sqlx::PgConnection>,
    key: i64,
}

#[async_trait::async_trait]
impl RunLock for PgRunLock {
    async fn release(mut self: Box<Self>) -> Result<(), OrchestratorError> {
        if let Some(mut conn) = self.conn.take() {
            sqlx::query("select pg_advisory_unlock($1)")
                .bind(self.key)
                .execute(&mut conn)
                .await
                .map_err(store_err)?;
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl SchedulerStore for PgSchedulerStore {
    /// `pg_try_advisory_lock` on a detached session — non-blocking, so a contended run is
    /// SKIPPED rather than queued behind a drive that may run for minutes.
    async fn try_lock_run(
        &self,
        run: RunId,
    ) -> Result<Option<Box<dyn RunLock>>, OrchestratorError> {
        // Acquire BEFORE locking, so a pool failure is a store error, not "someone holds it".
        let mut conn = self.pool.acquire().await.map_err(store_err)?.detach();
        let key = advisory_key(self.tenant, run);
        let (got,): (bool,) = sqlx::query_as("select pg_try_advisory_lock($1)")
            .bind(key)
            .fetch_one(&mut conn)
            .await
            .map_err(store_err)?;
        // Not taken ⇒ drop the connection here, closing the session (no leak per contended tick).
        Ok(got.then(|| {
            Box::new(PgRunLock {
                conn: Some(conn),
                key,
            }) as Box<dyn RunLock>
        }))
    }

    async fn enqueue(
        &self,
        run: RunId,
        graph: &Graph,
        now: DateTime<Utc>,
    ) -> Result<(), OrchestratorError> {
        let g = serde_json::to_value(graph).map_err(store_err_ser)?;
        let res = sqlx::query(
            "insert into runs.scheduled_runs \
             (tenant_id, run_id, graph, status, claimed_at, updated_at) \
             values ($1, $2, $3, 'waking', $4, $4) on conflict (tenant_id, run_id) do nothing",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(g)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(store_err)?;
        if res.rows_affected() == 0 {
            return Err(OrchestratorError::Store(format!(
                "duplicate submit for run {run:?}"
            )));
        }
        Ok(())
    }

    async fn record_paused(
        &self,
        run: RunId,
        next_wake: Option<DateTime<Utc>>,
        reason: &str,
    ) -> Result<(), OrchestratorError> {
        sqlx::query(
            "update runs.scheduled_runs set status = 'paused', next_wake = $3, claimed_at = null, \
                    reason = $4, updated_at = now() \
             where tenant_id = $1 and run_id = $2 and status = 'waking'",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(next_wake)
        .bind(reason)
        .execute(&self.pool)
        .await
        .map_err(store_err)?;
        Ok(())
    }

    async fn record_terminal(
        &self,
        run: RunId,
        status: RunStatus,
        reason: Option<&str>,
    ) -> Result<(), OrchestratorError> {
        sqlx::query(
            "update runs.scheduled_runs set status = $3::text::runs.run_status, next_wake = null, \
                    claimed_at = null, reason = $4, updated_at = now() \
             where tenant_id = $1 and run_id = $2 and status = 'waking'",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(status.as_str())
        .bind(reason)
        .execute(&self.pool)
        .await
        .map_err(store_err)?;
        Ok(())
    }

    async fn claim_due(
        &self,
        now: DateTime<Utc>,
        lease: chrono::Duration,
        limit: usize,
    ) -> Result<Vec<(RunId, Graph)>, OrchestratorError> {
        let stale_before = now - lease;
        // The due set is chosen and locked ONCE, in a MATERIALIZED CTE, then updated by join.
        // Not `… where run_id in (select … limit $4 for update skip locked)`: Postgres may plan
        // that as a nested-loop semi join that re-runs the limited subquery per outer row, and
        // one claim then takes every due run regardless of `limit`.
        let rows: Vec<(Uuid, serde_json::Value)> = sqlx::query_as(
            "with due as materialized ( \
                 select run_id from runs.scheduled_runs \
                 where tenant_id = $1 \
                   and ((status = 'paused' and next_wake is not null and next_wake <= $2) \
                     or (status = 'waking' and claimed_at < $3)) \
                 order by next_wake nulls last \
                 limit $4 \
                 for update skip locked) \
             update runs.scheduled_runs s \
                set status = 'waking', claimed_at = $2, updated_at = now() \
               from due \
              where s.tenant_id = $1 and s.run_id = due.run_id \
             returning s.run_id, s.graph",
        )
        .bind(self.tenant)
        .bind(now)
        .bind(stale_before)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(store_err)?;
        rows.into_iter()
            .map(|(id, g)| Ok((RunId(id), serde_json::from_value(g).map_err(store_err_ser)?)))
            .collect()
    }

    async fn status(&self, run: RunId) -> Result<Option<ScheduledRun>, OrchestratorError> {
        let row: Option<(String, Option<DateTime<Utc>>, Option<String>, DateTime<Utc>)> =
            sqlx::query_as(
                "select status::text, next_wake, reason, updated_at from runs.scheduled_runs \
                 where tenant_id = $1 and run_id = $2",
            )
            .bind(self.tenant)
            .bind(run.0)
            .fetch_optional(&self.pool)
            .await
            .map_err(store_err)?;
        Ok(row.map(|(s, nw, r, u)| ScheduledRun {
            run,
            status: RunStatus::from_db_str(&s).unwrap_or(RunStatus::Failed),
            next_wake: nw,
            reason: r,
            updated_at: u,
        }))
    }

    async fn list_paused(&self) -> Result<Vec<ScheduledRun>, OrchestratorError> {
        let rows: Vec<(Uuid, Option<DateTime<Utc>>, Option<String>, DateTime<Utc>)> =
            sqlx::query_as(
                "select run_id, next_wake, reason, updated_at from runs.scheduled_runs \
                 where tenant_id = $1 and status = 'paused'",
            )
            .bind(self.tenant)
            .fetch_all(&self.pool)
            .await
            .map_err(store_err)?;
        Ok(rows
            .into_iter()
            .map(|(id, nw, r, u)| ScheduledRun {
                run: RunId(id),
                status: RunStatus::Paused,
                next_wake: nw,
                reason: r,
                updated_at: u,
            })
            .collect())
    }

    async fn cancel(&self, run: RunId) -> Result<(), OrchestratorError> {
        sqlx::query(&format!(
            "update runs.scheduled_runs set status = 'cancelled', next_wake = null, \
                    updated_at = now() \
             where tenant_id = $1 and run_id = $2 and status not in ({TERMINAL_STATUS_LITERALS})"
        ))
        .bind(self.tenant)
        .bind(run.0)
        .execute(&self.pool)
        .await
        .map_err(store_err)?;
        Ok(())
    }

    async fn force_wake(&self, run: RunId, now: DateTime<Utc>) -> Result<(), OrchestratorError> {
        sqlx::query(
            "update runs.scheduled_runs set next_wake = $3, updated_at = now() \
             where tenant_id = $1 and run_id = $2 and status = 'paused'",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(store_err)?;
        Ok(())
    }

    async fn count_terminal_before(&self, before: DateTime<Utc>) -> Result<u64, OrchestratorError> {
        let (n,): (i64,) = sqlx::query_as(&format!(
            "select count(*) from runs.scheduled_runs \
             where tenant_id = $1 and status in ({TERMINAL_STATUS_LITERALS}) and updated_at < $2"
        ))
        .bind(self.tenant)
        .bind(before)
        .fetch_one(&self.pool)
        .await
        .map_err(store_err)?;
        // count(*) is never negative; the clamp keeps a hypothetical one from wrapping.
        Ok(n.max(0) as u64)
    }

    async fn prune_terminal(&self, before: DateTime<Utc>) -> Result<u64, OrchestratorError> {
        let res = sqlx::query(&format!(
            "delete from runs.scheduled_runs \
             where tenant_id = $1 and status in ({TERMINAL_STATUS_LITERALS}) and updated_at < $2"
        ))
        .bind(self.tenant)
        .bind(before)
        .execute(&self.pool)
        .await
        .map_err(store_err)?;
        Ok(res.rows_affected())
    }
}

/// The terminal-status ALLOWLIST, interpolated into the count, the delete and `cancel`'s guard
/// so they cannot drift apart. A compile-time `const` of SQL literals, never input. An
/// allowlist, deliberately: with `not in ('paused','waking')` a status this build does not
/// recognise would be DELETED by default; here it is kept.
const TERMINAL_STATUS_LITERALS: &str = "'completed','failed','cancelled'";

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins the hand-written allowlist to `RunStatus::is_terminal()`. A new variant must be
    /// added to `all` — the arity assertion makes forgetting visible.
    #[test]
    fn the_prune_allowlist_matches_run_status_is_terminal() {
        let all = [
            RunStatus::Waking,
            RunStatus::Paused,
            RunStatus::Completed,
            RunStatus::Failed,
            RunStatus::Cancelled,
        ];
        for st in all {
            let quoted = format!("'{}'", st.as_str());
            assert_eq!(
                TERMINAL_STATUS_LITERALS.contains(&quoted),
                st.is_terminal(),
                "{quoted} must appear in the prune allowlist iff it is terminal"
            );
        }
        assert_eq!(
            TERMINAL_STATUS_LITERALS.matches('\'').count() / 2,
            all.iter().filter(|s| s.is_terminal()).count()
        );
    }

    /// The same run id in two tenants keys two different locks.
    #[test]
    fn the_advisory_key_separates_tenants_for_the_same_run() {
        let run = RunId(Uuid::new_v4());
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert_ne!(advisory_key(a, run), advisory_key(b, run));
        assert_eq!(advisory_key(a, run), advisory_key(a, run));
    }
}
