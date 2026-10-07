//! AG-13 (torii#49, decision C5 #41): an agent run's money limit from torii's caps, and its spend
//! recorded back on them.
//!
//! torii configures the caps — `governance.nodes`, one per org unit, `hard` or `soft` — and the
//! engine enforces a run's limit (`RunBudget.money`: the run pauses when it is reached and resumes
//! when it is raised). This module is the torii half, shared by `torii run submit` and the API:
//!
//! - **Who** — [`RunCharges::resolve_issuer`]: the operator a run is submitted as (a
//!   `core.profiles` id), who must belong to the tenant.
//! - **How much** — [`RunCharges::admit`]: the issuer's headroom is the tightest `hard` cap
//!   (`cap − spent − reserved`) over every unit the issuer is a member of (the individual's
//!   personal unit, the groups) and every ancestor of those (the hierarchy). The run's limit is
//!   that headroom; an explicit limit may only lower it. No budget node at all refuses
//!   (fail-closed, as a question is refused).
//! - **Recorded back** — [`RunCharges::settle`]: the run's spend, folded from its journal with the
//!   engine's own fold, is added to every charged node, idempotently.
//! - **Raised** — [`RunCharges::check_raise`]: a paused run's new limit goes through the same cap
//!   check against the nodes it is charged to.

use orchestrator_core::{ExecutionJournal, MoneyBudget, RunId, MICRO_USD_PER_USD};
use sqlx::PgPool;
use uuid::Uuid;

/// The limit of a run whose issuer has no `hard` cap anywhere on its paths. A money limit is still
/// set — the engine ledgers a call's cost only while a money cap is in force, and that ledger is
/// what [`RunCharges::settle`] records back — but one no run reaches. `i64::MAX` so it is storable.
pub const UNBOUNDED_MICRO_USD: u64 = i64::MAX as u64;

/// A dollar figure for an operator, exactly: `1500000` → `$1.500000`.
pub fn usd(micro: u64) -> String {
    format!(
        "${}.{:06}",
        micro / MICRO_USD_PER_USD,
        micro % MICRO_USD_PER_USD
    )
}

/// Why a run's limit could not be admitted (or its spend recorded).
#[derive(Debug)]
pub enum ChargeError {
    /// The issuer is not a profile of this tenant.
    UnknownIssuer(String),
    /// Neither the issuer's units, their ancestors, nor the tenant's root has a budget node.
    NoBudgetNode,
    /// A limit above the headroom of the tightest `hard` cap.
    OverHeadroom {
        requested_micro_usd: u64,
        headroom_micro_usd: u64,
        node: String,
    },
    /// A raise on a run with no charge record (one submitted before caps were applied).
    NotCharged(RunId),
    /// The run id is already scheduled — a charge must never attach to someone else's run.
    AlreadyScheduled(RunId),
    Journal(String),
    Db(sqlx::Error),
}

impl std::fmt::Display for ChargeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChargeError::UnknownIssuer(who) => write!(
                f,
                "issuer {who:?} is not a user of this tenant (expected a core.profiles id with a \
                 membership or a unit in the tenant)"
            ),
            ChargeError::NoBudgetNode => write!(
                f,
                "no budget node covers this issuer: none of their org units, the units above \
                 them, or the tenant's root has a budget — a run is refused, as a question is"
            ),
            ChargeError::OverHeadroom {
                requested_micro_usd,
                headroom_micro_usd,
                node,
            } => write!(
                f,
                "a limit of {} exceeds the headroom of {} left under the hard cap of budget \
                 node {node:?}; a run's limit may only be at most its issuer's headroom",
                usd(*requested_micro_usd),
                usd(*headroom_micro_usd)
            ),
            ChargeError::NotCharged(run) => write!(
                f,
                "run {} has no budget charge (it was submitted before torii applied caps to \
                 runs), so its limit cannot be checked against them",
                run.0
            ),
            ChargeError::AlreadyScheduled(run) => {
                write!(f, "run {} already exists", run.0)
            }
            ChargeError::Journal(e) => write!(f, "reading the run's journal: {e}"),
            ChargeError::Db(e) => write!(f, "budget store: {e}"),
        }
    }
}

impl std::error::Error for ChargeError {}

impl From<sqlx::Error> for ChargeError {
    fn from(e: sqlx::Error) -> Self {
        ChargeError::Db(e)
    }
}

/// The headroom a set of budget nodes leaves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Headroom {
    /// Micro-dollars left under the tightest `hard` cap; `None` when no node has one.
    pub micro_usd: Option<u64>,
    /// The name of the org unit whose cap is the tightest.
    pub tightest: Option<String>,
    /// Every budget node the set covers — where the run's spend is recorded.
    pub nodes: Vec<Uuid>,
}

/// One budget node a run is (or would be) charged to.
struct NodeRow {
    id: Uuid,
    name: String,
    /// Micro-dollars left under its cap — `None` unless it is `hard` and capped.
    headroom: Option<i64>,
}

/// A node's headroom in whole micro-dollars, floored (never rounded up past the cap) and never
/// negative; `NULL` for a soft or uncapped node, which never limits a run.
const HEADROOM_MICRO_SQL: &str = "case when n.enforcement = 'hard' and n.cap_amount is not null \
     then greatest(0, floor((n.cap_amount - n.spent_amount - n.reserved_amount) * 1000000))::bigint \
     end";

/// The tightest of `rows`, and every node they cover.
fn tightest(rows: Vec<NodeRow>) -> Headroom {
    let mut best: Option<(i64, String)> = None;
    for r in &rows {
        if let Some(h) = r.headroom {
            if best.as_ref().is_none_or(|(b, _)| h < *b) {
                best = Some((h, r.name.clone()));
            }
        }
    }
    Headroom {
        micro_usd: best.as_ref().map(|(h, _)| *h as u64),
        tightest: best.map(|(_, n)| n),
        nodes: rows.into_iter().map(|r| r.id).collect(),
    }
}

/// `micro` as the `bigint` the charge table stores (a limit past it is unbounded in practice).
fn as_bigint(micro: u64) -> i64 {
    i64::try_from(micro).unwrap_or(i64::MAX)
}

/// One tenant's run charges, over torii's database.
#[derive(Clone)]
pub struct RunCharges {
    pool: PgPool,
    tenant: Uuid,
}

impl RunCharges {
    pub fn new(pool: PgPool, tenant: Uuid) -> Self {
        Self { pool, tenant }
    }

    /// The issuer a run is submitted as: a `core.profiles` id that belongs to this tenant — by a
    /// membership, or by a unit of the tenant's org tree.
    pub async fn resolve_issuer(&self, user: &str) -> Result<Uuid, ChargeError> {
        let user = user.trim();
        let Ok(id) = Uuid::parse_str(user) else {
            return Err(ChargeError::UnknownIssuer(user.to_string()));
        };
        let known: bool = sqlx::query_scalar(
            "select exists (select 1 from core.profiles p where p.id = $2 and ( \
               exists (select 1 from core.memberships m \
                        where m.profile_id = p.id and m.tenant_id = $1) \
               or exists (select 1 from core.unit_members um \
                           where um.profile_id = p.id and um.tenant_id = $1)))",
        )
        .bind(self.tenant)
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        if known {
            Ok(id)
        } else {
            Err(ChargeError::UnknownIssuer(user.to_string()))
        }
    }

    /// Every budget node over the issuer: each unit they are a member of (their personal unit and
    /// their groups) and every ancestor of those, each once. An issuer in no unit falls back to the
    /// tenant's root, as a question's budget does (`services/gateway` `budgets::resolve_node`).
    async fn issuer_nodes(&self, issuer: Uuid) -> Result<Vec<NodeRow>, ChargeError> {
        let rows: Vec<(Uuid, String, Option<i64>)> = sqlx::query_as(&format!(
            "with recursive mine as ( \
               select unit_id from core.unit_members where tenant_id = $1 and profile_id = $2 \
             ), start as ( \
               select unit_id as id from mine \
               union all \
               select id from core.org_units \
                where tenant_id = $1 and parent_id is null and not exists (select 1 from mine) \
             ), up as ( \
               select ou.id, ou.parent_id from core.org_units ou \
                 join start s on s.id = ou.id where ou.tenant_id = $1 \
               union \
               select ou.id, ou.parent_id from core.org_units ou \
                 join up on ou.id = up.parent_id where ou.tenant_id = $1 \
             ) \
             select n.id, ou.name, {HEADROOM_MICRO_SQL} \
               from (select distinct id from up) u \
               join governance.nodes n on n.tenant_id = $1 and n.org_unit_id = u.id \
               join core.org_units ou on ou.tenant_id = $1 and ou.id = u.id \
              order by ou.level, ou.name, n.id"
        ))
        .bind(self.tenant)
        .bind(issuer)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, headroom)| NodeRow { id, name, headroom })
            .collect())
    }

    /// The budget nodes `ids`, as they stand now.
    async fn nodes(&self, ids: &[Uuid]) -> Result<Vec<NodeRow>, ChargeError> {
        let rows: Vec<(Uuid, String, Option<i64>)> = sqlx::query_as(&format!(
            "select n.id, ou.name, {HEADROOM_MICRO_SQL} \
               from governance.nodes n \
               join core.org_units ou on ou.tenant_id = n.tenant_id and ou.id = n.org_unit_id \
              where n.tenant_id = $1 and n.id = any($2) \
              order by ou.level, ou.name, n.id"
        ))
        .bind(self.tenant)
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, headroom)| NodeRow { id, name, headroom })
            .collect())
    }

    /// The issuer's headroom: the tightest `hard` cap over their units and every ancestor.
    pub async fn headroom(&self, issuer: Uuid) -> Result<Headroom, ChargeError> {
        Ok(tightest(self.issuer_nodes(issuer).await?))
    }

    /// Admit `run` for `issuer`: its money limit is the headroom, or `requested` when that is
    /// lower; a `requested` above the headroom is refused and nothing is written. With no `hard`
    /// cap anywhere the limit is `requested`, else [`UNBOUNDED_MICRO_USD`].
    ///
    /// Records the run's charge — the issuer and the nodes its spend will be recorded on — so call
    /// it BEFORE the run is submitted: a run id already scheduled is refused, so a charge can never
    /// attach to another submitter's run.
    pub async fn admit(
        &self,
        run: RunId,
        issuer: Uuid,
        requested: Option<u64>,
    ) -> Result<MoneyBudget, ChargeError> {
        let scheduled: bool = sqlx::query_scalar(
            "select exists (select 1 from runs.scheduled_runs where tenant_id = $1 and run_id = $2)",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_one(&self.pool)
        .await?;
        if scheduled {
            return Err(ChargeError::AlreadyScheduled(run));
        }
        let rows = self.issuer_nodes(issuer).await?;
        if rows.is_empty() {
            return Err(ChargeError::NoBudgetNode);
        }
        let h = tightest(rows);
        let limit = match (requested, h.micro_usd) {
            (Some(r), Some(room)) if r > room => {
                return Err(ChargeError::OverHeadroom {
                    requested_micro_usd: r,
                    headroom_micro_usd: room,
                    node: h.tightest.unwrap_or_default(),
                });
            }
            (Some(r), _) => r,
            (None, Some(room)) => room,
            (None, None) => UNBOUNDED_MICRO_USD,
        };
        let inserted = sqlx::query(
            "insert into runs.run_charges \
               (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd) \
             values ($1, $2, $3, $4, $5) on conflict do nothing",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(issuer)
        .bind(&h.nodes)
        .bind(as_bigint(limit))
        .execute(&self.pool)
        .await?;
        if inserted.rows_affected() == 0 {
            return Err(ChargeError::AlreadyScheduled(run));
        }
        Ok(MoneyBudget {
            total_micro_usd: limit,
        })
    }

    /// Record `run`'s spend so far on every node it is charged to — only what is not recorded yet.
    /// Returns the micro-dollars this call recorded; a run with no charge records nothing.
    ///
    /// The spend is the engine's own fold of the journal (`orchestrator::money_spend_of`), never a
    /// second sum. Idempotent: the charge row is locked, only `spend − recorded` is added, and the
    /// watermark moves in the same transaction — a re-drive or a concurrent settle cannot count a
    /// call twice. A terminal run's charge is closed once its final spend is recorded.
    pub async fn settle(
        &self,
        journal: &dyn ExecutionJournal,
        run: RunId,
    ) -> Result<u64, ChargeError> {
        // The schedule row BEFORE the journal: a terminal status read here means the journal read
        // after it holds the run's final spend, and an `updated_at` that moves after this read
        // (another drive) is newer than the one recorded, so the next sweep settles again.
        let schedule: Option<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
            "select status::text, updated_at from runs.scheduled_runs \
              where tenant_id = $1 and run_id = $2",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&self.pool)
        .await?;
        let events = journal
            .load(run)
            .await
            .map_err(|e| ChargeError::Journal(e.to_string()))?;
        let (spent, _) = orchestrator::money_spend_of(&events);
        let terminal = schedule
            .as_ref()
            .is_some_and(|(s, _)| matches!(s.as_str(), "completed" | "failed" | "cancelled"));

        let mut tx = self.pool.begin().await?;
        let charge: Option<(Vec<Uuid>, i64)> = sqlx::query_as(
            "select node_ids, recorded_micro_usd from runs.run_charges \
              where tenant_id = $1 and run_id = $2 for update",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((nodes, recorded)) = charge else {
            return Ok(0);
        };
        let delta = spent.saturating_sub(recorded.max(0) as u64);
        if delta > 0 {
            // Lock the nodes in one order, so two settles sharing nodes cannot deadlock.
            sqlx::query(
                "select 1 from governance.nodes where tenant_id = $1 and id = any($2) \
                  order by id for update",
            )
            .bind(self.tenant)
            .bind(&nodes)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "update governance.nodes \
                    set spent_amount = spent_amount + $3::bigint::numeric / 1000000, \
                        modified_at = now() \
                  where tenant_id = $1 and id = any($2)",
            )
            .bind(self.tenant)
            .bind(&nodes)
            .bind(as_bigint(delta))
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            "update runs.run_charges \
                set recorded_micro_usd = greatest(recorded_micro_usd, $3), \
                    seen_updated_at = coalesce($4, seen_updated_at), \
                    settled = settled or $5 \
              where tenant_id = $1 and run_id = $2",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(as_bigint(spent))
        .bind(schedule.map(|(_, at)| at))
        .bind(terminal)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(delta)
    }

    /// [`settle`](Self::settle) every unsettled run of this tenant whose schedule moved since it
    /// was last settled — every drive ends by recording the run's schedule, so a run whose row has
    /// not moved has no new spend. Returns how many were settled. One run's failure does not stop
    /// the others; the first is returned after all were tried.
    pub async fn settle_pending(
        &self,
        journal: &dyn ExecutionJournal,
    ) -> Result<usize, ChargeError> {
        let runs: Vec<(Uuid,)> = sqlx::query_as(
            "select c.run_id from runs.run_charges c \
               join runs.scheduled_runs sr on sr.tenant_id = c.tenant_id and sr.run_id = c.run_id \
              where c.tenant_id = $1 and not c.settled \
                and (c.seen_updated_at is null or sr.updated_at > c.seen_updated_at)",
        )
        .bind(self.tenant)
        .fetch_all(&self.pool)
        .await?;
        let mut settled = 0;
        let mut first_error = None;
        for (run,) in runs {
            match self.settle(journal, RunId(run)).await {
                Ok(_) => settled += 1,
                Err(e) => {
                    first_error.get_or_insert(e);
                }
            }
        }
        match first_error {
            Some(e) => Err(e),
            None => Ok(settled),
        }
    }

    /// Whether `run`'s money limit may move to `new_total_micro_usd`. Lowering it always may. A
    /// raise may only leave the run at most the headroom of the nodes it is charged to: its
    /// spend so far is settled onto them first, so `new_total − spent ≤ headroom`.
    pub async fn check_raise(
        &self,
        journal: &dyn ExecutionJournal,
        run: RunId,
        new_total_micro_usd: u64,
    ) -> Result<(), ChargeError> {
        let nodes: Option<Vec<Uuid>> = sqlx::query_scalar(
            "select node_ids from runs.run_charges where tenant_id = $1 and run_id = $2",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&self.pool)
        .await?;
        let Some(nodes) = nodes else {
            return Err(ChargeError::NotCharged(run));
        };
        self.settle(journal, run).await?;
        let events = journal
            .load(run)
            .await
            .map_err(|e| ChargeError::Journal(e.to_string()))?;
        let (spent, cap) = orchestrator::money_spend_of(&events);
        if cap.is_some_and(|c| new_total_micro_usd <= c) {
            return Ok(());
        }
        let h = tightest(self.nodes(&nodes).await?);
        match h.micro_usd {
            Some(room) if new_total_micro_usd.saturating_sub(spent) > room => {
                Err(ChargeError::OverHeadroom {
                    requested_micro_usd: new_total_micro_usd,
                    headroom_micro_usd: room,
                    node: h.tightest.unwrap_or_default(),
                })
            }
            _ => Ok(()),
        }
    }
}
