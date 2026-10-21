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
//! - **Reserved** — the admitted limit is added to `reserved_amount` on every `hard`-capped node
//!   the run is charged to, under the node locks and in the same transaction as the charge row,
//!   so no two runs (and no run and a question's `budget_reserve`) are ever given the same
//!   headroom.
//! - **Recorded back** — [`RunCharges::settle`]: the run's spend, folded from its journal with the
//!   engine's own fold, is added to every charged node, idempotently, and converts as much of the
//!   reservation into spend; the final settle releases what is left of it.
//! - **Raised** — [`RunCharges::check_raise`]: a paused run's new limit goes through the same cap
//!   check against the nodes it is charged to, reserving only the increment (a lowering releases
//!   the difference).

use crate::stores::PgSchedulerStore;
use orchestrator_core::{ExecutionJournal, MoneyBudget, RunId, SchedulerStore, MICRO_USD_PER_USD};
use sqlx::PgPool;
use uuid::Uuid;

/// The limit of a run whose issuer has no `hard` cap anywhere on its paths. A money limit is still
/// set — the engine ledgers a call's cost only while a money cap is in force, and that ledger is
/// what [`RunCharges::settle`] records back — but one no run reaches. `i64::MAX` so it is storable.
pub const UNBOUNDED_MICRO_USD: u64 = i64::MAX as u64;

/// How long a CANCELLED run's drive claim must have stood before it counts as abandoned (its
/// worker died mid-drive, so no record will ever release it): an hour, far past the scheduler's
/// lease. Even then the charge is closed only while no drive holds the run's lock.
const ABANDONED_CLAIM_SQL: &str = "interval '1 hour'";

/// A dollar figure for an operator, exactly and without trailing zeros past the cents:
/// `1500000` → `$1.50`, `1` → `$0.000001` — the form `torii run status` prints.
pub fn usd(micro: u64) -> String {
    let frac = format!("{:06}", micro % MICRO_USD_PER_USD);
    let frac = frac.trim_end_matches('0');
    format!("${}.{frac:0<2}", micro / MICRO_USD_PER_USD)
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
    /// The tightest `hard` cap has no headroom left at all: a `$0` limit would pause the run on
    /// its first priced call, with nothing that could raise it.
    NoHeadroom {
        node: String,
    },
    /// A raise on a run with no charge record (one submitted before caps were applied).
    NotCharged(RunId),
    /// The run id is already scheduled — a charge must never attach to someone else's run.
    AlreadyScheduled(RunId),
    Journal(String),
    /// Reading the run's schedule (its drive lock) failed.
    Schedule(String),
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
            ChargeError::NoHeadroom { node } => write!(
                f,
                "no headroom is left under the hard cap of budget node {node:?} (its spend and \
                 the limits of the runs still holding it use all of it), so a run would pause \
                 before its first priced call"
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
            ChargeError::Schedule(e) => write!(f, "reading the run's schedule: {e}"),
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
///
/// `$3`/`$4` credit a run's OWN reservation back: `$4` micro-dollars on every node in `$3` — the
/// headroom a raise of that run sees (its reservation is already in `reserved_amount`). Added
/// before the floor, so an over-committed node is not credited past what it really has.
const HEADROOM_MICRO_SQL: &str = "case when n.enforcement = 'hard' and n.cap_amount is not null \
     then greatest(0, floor((n.cap_amount - n.spent_amount - n.reserved_amount \
       + case when n.id = any($3) then $4::bigint::numeric / 1000000 else 0 end) \
       * 1000000))::bigint \
     end";

/// Lock the budget nodes `ids` in one order (by id), so two transactions sharing nodes cannot
/// deadlock; every reservation and settle takes them this way.
async fn lock_nodes(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    ids: &[Uuid],
) -> Result<(), ChargeError> {
    sqlx::query(
        "select 1 from governance.nodes where tenant_id = $1 and id = any($2) \
          order by id for update",
    )
    .bind(tenant)
    .bind(ids)
    .execute(conn)
    .await?;
    Ok(())
}

/// Move `reserved_amount` by `micro` (positive reserves, negative releases) on the nodes `ids`;
/// a release never takes a node below zero.
async fn move_reservation(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    ids: &[Uuid],
    micro: i64,
) -> Result<(), ChargeError> {
    if ids.is_empty() || micro == 0 {
        return Ok(());
    }
    sqlx::query(
        "update governance.nodes \
            set reserved_amount = greatest(0, reserved_amount + $3::bigint::numeric / 1000000), \
                modified_at = now() \
          where tenant_id = $1 and id = any($2)",
    )
    .bind(tenant)
    .bind(ids)
    .bind(micro)
    .execute(conn)
    .await?;
    Ok(())
}

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

/// Delete `run`'s charge row and release the `held` micro-dollars it reserved on `reserve` (the
/// caller holds the row and node locks).
async fn drop_charge(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    run: RunId,
    reserve: &[Uuid],
    held: i64,
) -> Result<(), ChargeError> {
    move_reservation(&mut *conn, tenant, reserve, -held.max(0)).await?;
    sqlx::query("delete from runs.run_charges where tenant_id = $1 and run_id = $2")
        .bind(tenant)
        .bind(run.0)
        .execute(conn)
        .await?;
    Ok(())
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
    async fn issuer_nodes(
        &self,
        conn: &mut sqlx::PgConnection,
        issuer: Uuid,
    ) -> Result<Vec<NodeRow>, ChargeError> {
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
        .bind(Vec::<Uuid>::new())
        .bind(0i64)
        .fetch_all(conn)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, headroom)| NodeRow { id, name, headroom })
            .collect())
    }

    /// The budget nodes `ids`, as they stand now — `own_micro` credited back on `own_ids` (see
    /// [`HEADROOM_MICRO_SQL`]).
    async fn nodes(
        &self,
        conn: &mut sqlx::PgConnection,
        ids: &[Uuid],
        own_ids: &[Uuid],
        own_micro: i64,
    ) -> Result<Vec<NodeRow>, ChargeError> {
        let rows: Vec<(Uuid, String, Option<i64>)> = sqlx::query_as(&format!(
            "select n.id, ou.name, {HEADROOM_MICRO_SQL} \
               from governance.nodes n \
               join core.org_units ou on ou.tenant_id = n.tenant_id and ou.id = n.org_unit_id \
              where n.tenant_id = $1 and n.id = any($2) \
              order by ou.level, ou.name, n.id"
        ))
        .bind(self.tenant)
        .bind(ids)
        .bind(own_ids)
        .bind(own_micro)
        .fetch_all(conn)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, headroom)| NodeRow { id, name, headroom })
            .collect())
    }

    /// The issuer's headroom: the tightest `hard` cap over their units and every ancestor.
    pub async fn headroom(&self, issuer: Uuid) -> Result<Headroom, ChargeError> {
        let mut conn = self.pool.acquire().await?;
        Ok(tightest(self.issuer_nodes(&mut conn, issuer).await?))
    }

    /// Admit `run` for `issuer`: its money limit is the headroom, or `requested` when that is
    /// lower; a `requested` above the headroom is refused and nothing is written. With no `hard`
    /// cap anywhere the limit is `requested`, else [`UNBOUNDED_MICRO_USD`].
    ///
    /// The limit is RESERVED: in one transaction the issuer's nodes are locked (by id), the
    /// headroom is read under the locks, the limit is added to `reserved_amount` on every
    /// `hard`-capped one and the charge row is written — so concurrent admissions serialize and
    /// never share headroom. Nothing is reserved where no `hard` cap binds.
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
        let mut tx = self.pool.begin().await?;
        let scheduled: bool = sqlx::query_scalar(
            "select exists (select 1 from runs.scheduled_runs where tenant_id = $1 and run_id = $2)",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_one(&mut *tx)
        .await?;
        if scheduled {
            return Err(ChargeError::AlreadyScheduled(run));
        }
        // A charge with no schedule row is an orphan when its submit died before `enqueue` (a
        // store fault, Ctrl-C): still open, nothing recorded, and no journal — the run never
        // started. The same issuer's retry takes it over — releasing its reservation — rather
        // than finding the run id "already" taken; another issuer's is not theirs to take.
        // G4-1: a charge with no schedule row is ALSO a run `torii run prune` removed, and that
        // one ran: its spend is recorded (or still to be) from its journal, which a re-admitted
        // run would append to and have folded again. Anything but a true orphan is taken.
        let orphan: Option<(Uuid, Vec<Uuid>, i64, bool)> = sqlx::query_as(
            "select c.issuer_profile_id, c.reserve_node_ids, c.reserved_micro_usd, \
                    not c.settled and c.recorded_micro_usd = 0 \
                      and not exists (select 1 from runs.journal_events e \
                                       where e.tenant_id = c.tenant_id and e.run_id = c.run_id) \
               from runs.run_charges c \
              where c.tenant_id = $1 and c.run_id = $2 for update of c",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&mut *tx)
        .await?;
        if orphan
            .as_ref()
            .is_some_and(|(owner, _, _, never_ran)| *owner != issuer || !never_ran)
        {
            return Err(ChargeError::AlreadyScheduled(run));
        }
        let ids: Vec<Uuid> = self
            .issuer_nodes(&mut tx, issuer)
            .await?
            .into_iter()
            .map(|r| r.id)
            .collect();
        if ids.is_empty() {
            return Err(ChargeError::NoBudgetNode);
        }
        // Under the locks a second statement reads what every earlier admission committed. The
        // orphan's nodes are locked in the same (id-ordered) statement, so no two admissions can
        // take them in different orders.
        let mut locked = ids.clone();
        if let Some((_, reserve, _, _)) = &orphan {
            locked.extend(reserve.iter().filter(|id| !ids.contains(id)));
        }
        lock_nodes(&mut tx, self.tenant, &locked).await?;
        if let Some((_, reserve, held, _)) = &orphan {
            drop_charge(&mut tx, self.tenant, run, reserve, *held).await?;
        }
        let rows = self.nodes(&mut tx, &ids, &[], 0).await?;
        let reserve: Vec<Uuid> = rows
            .iter()
            .filter(|r| r.headroom.is_some())
            .map(|r| r.id)
            .collect();
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
            (None, Some(0)) => {
                return Err(ChargeError::NoHeadroom {
                    node: h.tightest.unwrap_or_default(),
                });
            }
            (None, Some(room)) => room,
            (None, None) => UNBOUNDED_MICRO_USD,
        };
        // Only a `hard` cap bounds the limit, so the reservation always fits the nodes it is on.
        let held = if reserve.is_empty() {
            0
        } else {
            as_bigint(limit)
        };
        move_reservation(&mut tx, self.tenant, &reserve, held).await?;
        let inserted = sqlx::query(
            "insert into runs.run_charges \
               (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd, \
                reserve_node_ids, reserved_micro_usd) \
             values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(issuer)
        .bind(&h.nodes)
        .bind(as_bigint(limit))
        .bind(&reserve)
        .bind(held)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 0 {
            // Dropping the transaction rolls the reservation back with it.
            return Err(ChargeError::AlreadyScheduled(run));
        }
        tx.commit().await?;
        Ok(MoneyBudget {
            total_micro_usd: limit,
        })
    }

    /// Drop `run`'s charge if its submit never reached `enqueue` — no schedule row exists —
    /// releasing its reservation. Returns whether one was dropped. A charge whose run IS
    /// scheduled is never touched: its spend is still to be recorded. `run submit` calls this
    /// whenever `submit` fails, so a failed submit leaves neither an orphan charge nor a held
    /// reservation behind.
    pub async fn abandon(&self, run: RunId) -> Result<bool, ChargeError> {
        let mut tx = self.pool.begin().await?;
        let orphan: Option<(Vec<Uuid>, i64)> = sqlx::query_as(
            "select c.reserve_node_ids, c.reserved_micro_usd from runs.run_charges c \
              where c.tenant_id = $1 and c.run_id = $2 \
                and not exists (select 1 from runs.scheduled_runs sr \
                                 where sr.tenant_id = c.tenant_id and sr.run_id = c.run_id) \
              for update",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((reserve, held)) = orphan else {
            return Ok(false);
        };
        lock_nodes(&mut tx, self.tenant, &reserve).await?;
        drop_charge(&mut tx, self.tenant, run, &reserve, held).await?;
        tx.commit().await?;
        Ok(true)
    }

    /// Record `run`'s spend so far on every node it is charged to — only what is not recorded yet.
    /// Returns the micro-dollars this call recorded; a run with no charge records nothing.
    ///
    /// The spend is the engine's own fold of the journal (`orchestrator::money_spend_of`), never a
    /// second sum. Idempotent: the charge row is locked, only `spend − recorded` is added, and the
    /// watermark moves in the same transaction — a re-drive or a concurrent settle cannot count a
    /// call twice. The recorded spend converts as much of the run's reservation (reserved −=
    /// delta, never below zero); a terminal run's charge is closed once its final spend is
    /// recorded, releasing what is left of the reservation.
    pub async fn settle(
        &self,
        journal: &dyn ExecutionJournal,
        run: RunId,
    ) -> Result<u64, ChargeError> {
        // The schedule row BEFORE the journal: a terminal status read here means the journal read
        // after it holds the run's final spend, and an `updated_at` that moves after this read
        // (another drive) is newer than the one recorded, so the next sweep settles again.
        let schedule: Option<(String, chrono::DateTime<chrono::Utc>, bool, bool)> =
            sqlx::query_as(&format!(
                "select status::text, updated_at, claimed_at is not null, \
                        coalesce(claimed_at < now() - {ABANDONED_CLAIM_SQL}, false) \
                   from runs.scheduled_runs where tenant_id = $1 and run_id = $2"
            ))
            .bind(self.tenant)
            .bind(run.0)
            .fetch_optional(&self.pool)
            .await?;
        // G1-3: `cancel` can flip a run whose drive is still running (its claim stands), and that
        // drive keeps spending; its record releases the claim when it ends. So a cancelled run is
        // final only with no claim — or with one long abandoned (its worker died) while no drive
        // holds the run's lock, which is held across the journal read below so none can start.
        let mut drive_lock = None;
        let terminal = match schedule.as_ref() {
            Some((s, _, _, _)) if matches!(s.as_str(), "completed" | "failed") => true,
            Some((s, _, claimed, abandoned)) if s == "cancelled" => {
                if !claimed {
                    true
                } else if *abandoned {
                    drive_lock = PgSchedulerStore::new(self.pool.clone(), self.tenant)
                        .try_lock_run(run)
                        .await
                        .map_err(|e| ChargeError::Schedule(e.to_string()))?;
                    drive_lock.is_some()
                } else {
                    false
                }
            }
            _ => false,
        };
        let settled = self
            .record(journal, run, schedule.map(|s| s.1), terminal)
            .await;
        if let Some(lock) = drive_lock {
            lock.release()
                .await
                .map_err(|e| ChargeError::Schedule(e.to_string()))?;
        }
        settled
    }

    /// The body of [`settle`](Self::settle): fold `run`'s journal and record what is new, closing
    /// the charge when `terminal`.
    async fn record(
        &self,
        journal: &dyn ExecutionJournal,
        run: RunId,
        seen: Option<chrono::DateTime<chrono::Utc>>,
        terminal: bool,
    ) -> Result<u64, ChargeError> {
        let events = journal
            .load(run)
            .await
            .map_err(|e| ChargeError::Journal(e.to_string()))?;
        let (spent, _) = orchestrator::money_spend_of(&events);

        let mut tx = self.pool.begin().await?;
        let charge: Option<(Vec<Uuid>, i64, Vec<Uuid>, i64)> = sqlx::query_as(
            "select node_ids, recorded_micro_usd, reserve_node_ids, reserved_micro_usd \
               from runs.run_charges \
              where tenant_id = $1 and run_id = $2 for update",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((nodes, recorded, reserve, held)) = charge else {
            return Ok(0);
        };
        let delta = spent.saturating_sub(recorded.max(0) as u64);
        let held = held.max(0) as u64;
        // The spend takes its own reservation's place; the final settle frees the remainder.
        let converted = delta.min(held);
        let freed = if terminal { held } else { converted };
        if delta > 0 || freed > 0 {
            let mut locked = nodes.clone();
            locked.extend(reserve.iter().filter(|id| !nodes.contains(id)));
            lock_nodes(&mut tx, self.tenant, &locked).await?;
        }
        move_reservation(&mut tx, self.tenant, &reserve, -as_bigint(freed)).await?;
        if delta > 0 {
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
                    settled = settled or $5, \
                    reserved_micro_usd = $6 \
              where tenant_id = $1 and run_id = $2",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(as_bigint(spent))
        .bind(seen)
        .bind(terminal)
        .bind(as_bigint(held - freed))
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
        let runs: Vec<(Uuid,)> = sqlx::query_as(&format!(
            "select c.run_id from runs.run_charges c \
               join runs.scheduled_runs sr on sr.tenant_id = c.tenant_id and sr.run_id = c.run_id \
              where c.tenant_id = $1 and not c.settled \
                and (c.seen_updated_at is null or sr.updated_at > c.seen_updated_at \
                     or (sr.status = 'cancelled' and sr.claimed_at < now() - {ABANDONED_CLAIM_SQL}))",
        ))
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

    /// Whether `run`'s money limit may move to `new_total_micro_usd`, reserving for it. Lowering
    /// always may. A raise may only leave the run at most the headroom of the nodes it is charged
    /// to — its spend so far is settled onto them first, and its own reservation counts as its
    /// own — so `new_total − spent ≤ headroom`; the increment is reserved under the node locks.
    ///
    /// This only ever RESERVES: nothing is released until the new limit is committed (G2-4) — a
    /// lowering whose journal write then fails leaves the run at its old, higher cap, which its
    /// reservation must still cover. Once the move is written (or failed to be),
    /// [`release_to_cap`](Self::release_to_cap) gives back whatever the cap in force no longer
    /// needs: a lowering's difference, or a failed raise's increment.
    pub async fn check_raise(
        &self,
        journal: &dyn ExecutionJournal,
        run: RunId,
        new_total_micro_usd: u64,
    ) -> Result<(), ChargeError> {
        let charged: bool = sqlx::query_scalar(
            "select exists (select 1 from runs.run_charges where tenant_id = $1 and run_id = $2)",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_one(&self.pool)
        .await?;
        if !charged {
            return Err(ChargeError::NotCharged(run));
        }
        self.settle(journal, run).await?;
        let events = journal
            .load(run)
            .await
            .map_err(|e| ChargeError::Journal(e.to_string()))?;
        let (spent, cap) = orchestrator::money_spend_of(&events);
        let lowering = cap.is_some_and(|c| new_total_micro_usd <= c);
        let needed = new_total_micro_usd.saturating_sub(spent);

        let mut tx = self.pool.begin().await?;
        let (nodes, reserve, held, settled): (Vec<Uuid>, Vec<Uuid>, i64, bool) = sqlx::query_as(
            "select node_ids, reserve_node_ids, reserved_micro_usd, settled from runs.run_charges \
              where tenant_id = $1 and run_id = $2 for update",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_one(&mut *tx)
        .await?;
        if settled {
            // A closed charge holds nothing, and a finished run cannot be raised (`wake` refuses).
            return Ok(());
        }
        let held = held.max(0) as u64;
        lock_nodes(&mut tx, self.tenant, &nodes).await?;
        // A raise past what the run holds reserves the increment, checked first. Anything else
        // — a lowering, or a raise its reservation already covers — changes nothing here: a
        // release waits for the new limit to be committed (`release_to_cap`).
        if lowering || needed <= held {
            return Ok(());
        }
        let h = tightest(
            self.nodes(&mut tx, &nodes, &reserve, as_bigint(held))
                .await?,
        );
        if let Some(room) = h.micro_usd.filter(|room| needed > *room) {
            return Err(ChargeError::OverHeadroom {
                requested_micro_usd: new_total_micro_usd,
                headroom_micro_usd: room,
                node: h.tightest.unwrap_or_default(),
            });
        }
        let target = needed;
        if !reserve.is_empty() {
            move_reservation(
                &mut tx,
                self.tenant,
                &reserve,
                as_bigint(target) - as_bigint(held),
            )
            .await?;
            sqlx::query(
                "update runs.run_charges set reserved_micro_usd = $3 \
                  where tenant_id = $1 and run_id = $2",
            )
            .bind(self.tenant)
            .bind(run.0)
            .bind(as_bigint(target))
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Release what `run`'s reservation holds beyond what the money cap IN FORCE (the journal's
    /// fold) still leaves it to spend — `cap − recorded spend`, both read in the reservation's own
    /// frame. Only ever releases, so it needs no headroom and cannot fail for want of it. Call it
    /// after a limit move [`check_raise`](Self::check_raise) admitted has been written — or has
    /// failed to be: a committed lowering gives its difference back, a raise that never landed
    /// gives back the increment reserved for it, and a committed raise changes nothing.
    pub async fn release_to_cap(
        &self,
        journal: &dyn ExecutionJournal,
        run: RunId,
    ) -> Result<(), ChargeError> {
        let events = journal
            .load(run)
            .await
            .map_err(|e| ChargeError::Journal(e.to_string()))?;
        let Some(cap) = orchestrator::money_spend_of(&events).1 else {
            return Ok(());
        };
        let mut tx = self.pool.begin().await?;
        let charge: Option<(Vec<Uuid>, i64, i64, bool)> = sqlx::query_as(
            "select reserve_node_ids, reserved_micro_usd, recorded_micro_usd, settled \
               from runs.run_charges where tenant_id = $1 and run_id = $2 for update",
        )
        .bind(self.tenant)
        .bind(run.0)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((reserve, held, recorded, false)) = charge else {
            return Ok(());
        };
        let held = held.max(0) as u64;
        let target = cap.saturating_sub(recorded.max(0) as u64);
        if reserve.is_empty() || target >= held {
            return Ok(());
        }
        lock_nodes(&mut tx, self.tenant, &reserve).await?;
        move_reservation(
            &mut tx,
            self.tenant,
            &reserve,
            as_bigint(target) - as_bigint(held),
        )
        .await?;
        sqlx::query(
            "update runs.run_charges set reserved_micro_usd = $3 \
              where tenant_id = $1 and run_id = $2",
        )
        .bind(self.tenant)
        .bind(run.0)
        .bind(as_bigint(target))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
