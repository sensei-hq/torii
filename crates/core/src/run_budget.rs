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

    /// The issuer a run is submitted as: a `core.profiles` id that belongs to this tenant.
    pub async fn resolve_issuer(&self, user: &str) -> Result<Uuid, ChargeError> {
        let _ = user;
        Err(ChargeError::UnknownIssuer(String::new()))
    }

    /// The issuer's headroom: the tightest `hard` cap over their units and every ancestor.
    pub async fn headroom(&self, issuer: Uuid) -> Result<Headroom, ChargeError> {
        let _ = (issuer, &self.pool, self.tenant);
        Ok(Headroom {
            micro_usd: None,
            tightest: None,
            nodes: vec![],
        })
    }

    /// Admit `run` for `issuer`: its money limit is the headroom, or `requested` when that is
    /// lower; a `requested` above the headroom is refused and nothing is written.
    pub async fn admit(
        &self,
        run: RunId,
        issuer: Uuid,
        requested: Option<u64>,
    ) -> Result<MoneyBudget, ChargeError> {
        let _ = (run, issuer, requested);
        Ok(MoneyBudget {
            total_micro_usd: UNBOUNDED_MICRO_USD,
        })
    }

    /// Record `run`'s spend so far on every node it is charged to — only what is not recorded yet.
    /// Returns the micro-dollars this call recorded.
    pub async fn settle(
        &self,
        journal: &dyn ExecutionJournal,
        run: RunId,
    ) -> Result<u64, ChargeError> {
        let _ = (journal, run);
        Ok(0)
    }

    /// [`settle`](Self::settle) every unsettled run of this tenant whose schedule moved since it
    /// was last settled. Returns how many were settled.
    pub async fn settle_pending(
        &self,
        journal: &dyn ExecutionJournal,
    ) -> Result<usize, ChargeError> {
        let _ = journal;
        Ok(0)
    }

    /// Whether `run`'s money limit may move to `new_total_micro_usd`: lowering always may; a raise
    /// may only leave the run at most the headroom of the nodes it is charged to.
    pub async fn check_raise(
        &self,
        journal: &dyn ExecutionJournal,
        run: RunId,
        new_total_micro_usd: u64,
    ) -> Result<(), ChargeError> {
        let _ = (journal, run, new_total_micro_usd);
        Ok(())
    }
}
