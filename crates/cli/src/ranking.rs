//! The measured-ranking resolver (§8.2): one `catalog.ranked_chain` read per run per
//! category, turned into the [`ChoiceOrder`] a decision selector carries.
//!
//! Two rules shape everything here.
//!
//! **A resolver failure is not a run failure.** Torii's measurement being unavailable (no
//! database, a query error, a category nobody has measured) must leave the gateway fully
//! usable: no ranking is sent, the chain's authored order stands, and the boot log says
//! why. The alternative — refusing to boot — would couple every run to a table that is
//! allowed to be empty.
//!
//! **The order is a set of survivors, never a filter.** `ranked_chain` already decides
//! membership (the quality margin, §8.1a); this module only transcribes the rows it says
//! are admissible, in the order it says. Nothing here re-sorts, invents a rank for a tie,
//! or includes a model the margin excluded — a ranking that could promote a model outside
//! the margin would silently convert a quality guarantee into a token bill.

use kernel::types::capability::Capability;
use kernel::types::config::GatewayConfig;
use kernel::types::decision::{DecisionQuestion, DecisionQuestions};
use kernel::types::request::Payload;
use orchestrator::DecisionPlannerSelector;
use orchestrator_core::{
    AgentRef, ChoiceAnswer, ChoiceOrder, ChoiceOrderKind, ChoiceQuestion, ChoiceRef, ModelDispatch,
    OrchestratorError, PlannerSelector,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::errors::CliError;

/// `TORII_PLANNER_SELECTOR`: `rule` (the default, spend-free) or `decision`.
pub const ENV_SELECTOR: &str = "TORII_PLANNER_SELECTOR";
/// `TORII_DECISION_CHAIN`: the chain a decision call runs on. Default [`DEFAULT_CHAIN`].
pub const ENV_CHAIN: &str = "TORII_DECISION_CHAIN";
/// `TORII_DECISION_CATEGORY`: the benchmark category whose measurement orders the menu.
/// Default [`DEFAULT_CATEGORY`].
pub const ENV_CATEGORY: &str = "TORII_DECISION_CATEGORY";
/// The seeded `Decision` chain. A separate chain from `chat` on purpose: a decision model
/// answering prose, or a chat model asked for a choice, is a request the provider refuses.
pub const DEFAULT_CHAIN: &str = "decide";
/// The category decision-bench measured for planner selection.
pub const DEFAULT_CATEGORY: &str = "planner.select";
/// The capability a decision chain must serve.
const DECISION_CAPABILITY: &str = "decision";
/// Where the rows came from, recorded on every order so a call can be re-derived.
const ARTIFACT: &str = "torii:catalog.model_rankings";
/// The rule a tie is broken by. Named rather than implied: a policy order must be
/// distinguishable, after the fact, from an order a measurement produced. The suffix is
/// the rotation ([`TieRotation`]): local first, and the first slot inside each plane taken
/// in turn by the decision's own question.
pub const POLICY_TIE_ORDER: &str = "policy:local-first-rotation";

/// One chain candidate as the resolver function reports it: the chain step, its endpoint
/// and the measurement columns attached to it.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// The chain's own model name — what an error message should name.
    pub model: String,
    /// The router that serves it.
    pub router: String,
    /// `local` or `cloud` — the tie-break axis (see [`POLICY_TIE_ORDER`]).
    pub plane: Option<String>,
    /// The API model id on that router; `None` when no active endpoint resolves, in which
    /// case the chain model name is the best identifier available.
    pub api_model: Option<String>,
    /// Authored chain position — the tie-break when measurements cannot order two rows.
    pub sequence: i32,
    /// `Some` only for a `winner`: a tie is a set, not a sequence.
    pub rank: Option<i32>,
    pub verdict: Option<String>,
    /// `None` when there is no order to claim at all (tie / insufficient / unmeasured).
    pub within_margin: Option<bool>,
    pub revision: Option<i64>,
    pub generated_at: Option<i64>,
}

/// What will order the menu, when something will.
#[derive(Debug, Clone, PartialEq)]
pub enum Ordering {
    /// Rows a measurement ordered, with the artifact and revision behind them.
    Measured(ChoiceOrder),
    /// A TIE: nothing measured an order, so each decision is ordered by the rule in
    /// [`TieRotation`] — a policy, reported as one everywhere it is used.
    Tie(TieRotation),
}

/// The resolved state of one category: the order to send, or the reason there is none.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub category: String,
    /// How many chain candidates the tenant has for this capability.
    pub chained: usize,
    /// How many of them the margin admits.
    pub admissible: usize,
    /// Measured models the margin excluded, by chain name. Reported, never sent: they stay
    /// chain fallbacks (§8.1a — the margin governs the ranking, not the chain).
    pub filtered: Vec<String>,
    pub verdict: Option<String>,
    pub revision: Option<u64>,
    /// `None` ⇒ send no ranking; [`Snapshot::reason`] says why.
    pub ordering: Option<Ordering>,
    pub reason: String,
}

impl Snapshot {
    /// One line for the boot log: what will order the menu, or why nothing will.
    pub fn describe(&self) -> String {
        let filtered = if self.filtered.is_empty() {
            "none".to_string()
        } else {
            self.filtered.join(", ")
        };
        match &self.ordering {
            // A measured order reports the measurement it came from.
            Some(Ordering::Measured(order)) => format!(
                "{} of {} chain models within margin, {} ranked (revision {}, filtered: {filtered})",
                self.admissible,
                self.chained,
                order.preferred.len(),
                self.revision
                    .map(|r| r.to_string())
                    .unwrap_or_else(|| "none".into()),
            ),
            // A tie is reported as exactly that: the admissible counts describe a
            // measurement this order does not have, and the rule is named so nobody
            // reading the log mistakes a rotation for a measured sequence.
            Some(Ordering::Tie(tie)) => format!(
                "ordered by {} over {} models, rotating per decision, no measurement claimed \
                 (filtered: {filtered})",
                POLICY_TIE_ORDER,
                tie.planes.iter().map(Vec::len).sum::<usize>(),
            ),
            None => format!("no ranking: {}", self.reason),
        }
    }
}

/// Compose the snapshot from the resolver's rows. Pure, so every rule above is testable
/// without a database.
pub fn compose(category: &str, rows: &[Candidate]) -> Snapshot {
    let verdict = rows.iter().find_map(|r| r.verdict.clone());
    let revision = rows.iter().find_map(|r| r.revision).map(|r| r as u64);
    let generated_at = rows.iter().find_map(|r| r.generated_at);

    let mut admissible: Vec<&Candidate> = rows
        .iter()
        .filter(|r| r.within_margin == Some(true))
        .collect();
    // Rank first; the authored sequence breaks a tie in a partially-ranked category
    // deterministically rather than by row order.
    admissible.sort_by_key(|r| (r.rank.unwrap_or(i32::MAX), r.sequence));

    let filtered: Vec<String> = rows
        .iter()
        .filter(|r| r.within_margin == Some(false))
        .map(|r| r.model.clone())
        .collect();

    let mut snapshot = Snapshot {
        category: category.to_string(),
        chained: rows.len(),
        admissible: admissible.len(),
        filtered,
        verdict: verdict.clone(),
        revision,
        ordering: None,
        reason: String::new(),
    };

    snapshot.reason = if rows.is_empty() {
        "the chain has no models for this capability".to_string()
    } else if verdict.as_deref() == Some("tie") && rows.len() >= 2 {
        // A TIE is a measured set with no order to claim, not an absence of information: the
        // models were all measured and scored the same. Breaking it with a deterministic rule
        // is therefore legitimate — but it is a POLICY, and it travels as an authored order so
        // no trace ever reports it as evidence (`ChoiceOrderKind::Policy`).
        //
        // What is carried here is the GROUPS, not a sequence: local before cloud is fixed,
        // while the first slot inside each plane turns with the decision, and this snapshot is
        // resolved once per boot ([`TieRotation`]).
        snapshot.ordering = Some(Ordering::Tie(tie_rotation(category, rows)));
        format!(
            "verdict tie: ordered by {POLICY_TIE_ORDER} ({} models, no measurement claimed)",
            rows.len()
        )
    } else if admissible.is_empty() {
        match verdict.as_deref() {
            // A tie that reached here has fewer than two models to order.
            Some("tie") => {
                "verdict tie over fewer than 2 models: there is nothing to order".to_string()
            }
            Some("insufficient") => "verdict insufficient: there is no order to claim".to_string(),
            _ if rows.iter().all(|r| r.within_margin.is_none()) => {
                format!("no measurement for category {category}")
            }
            _ => "nothing within margin".to_string(),
        }
    } else if admissible.len() < 2 {
        // One admissible model is not an order, and an order that names exactly one model
        // would make the gateway's stable re-rank a no-op while claiming to have ranked.
        "fewer than 2 models within margin: there is nothing to order".to_string()
    } else {
        snapshot.ordering = Some(Ordering::Measured(ChoiceOrder {
            kind: ChoiceOrderKind::Measured,
            category: category.to_string(),
            preferred: refs(&admissible),
            artifact: Some(ARTIFACT.to_string()),
            revision,
            generated_at,
        }));
        "ordered by measurement".to_string()
    };

    snapshot
}

/// The tie rule (§8.1a): local models before cloud ones, and, inside each plane, the first
/// slot taken in turn by the decision's own question.
///
/// The rotation exists because a fixed sequence over a tie sends every decision to the same
/// member: "equal on the measurement" would become "one of them always answers". Taking the
/// turn from the question — the goal the decision is asked about — spreads it while keeping
/// each decision reproducible, which is not a nicety: the order is part of the gateway's
/// decision memo key, so a rotation that depended on process state (a counter, a clock, a
/// random seed) would hand the same call a different order on resume and trip
/// `DeterminismViolation` instead of replaying it. A repeated identical question therefore
/// gets the same order on purpose: it is the same decision, and its journal entry says so.
#[derive(Debug, Clone, PartialEq)]
pub struct TieRotation {
    /// What this rule orders; recorded on every order it produces.
    pub category: String,
    /// One group per plane, local first, each in the chain's AUTHORED order — the turn is
    /// taken inside a group, so the rule never moves a cloud model ahead of a local one.
    pub planes: Vec<Vec<ChoiceRef>>,
}

impl TieRotation {
    /// The order THIS decision runs under. Rotation moves the start of each plane, never
    /// its membership.
    pub fn order_for(&self, goal: &serde_json::Value) -> ChoiceOrder {
        let seed = fnv1a(&canonical(goal));
        let mut preferred = Vec::new();
        for plane in &self.planes {
            let start = (seed % plane.len() as u64) as usize;
            preferred.extend_from_slice(&plane[start..]);
            preferred.extend_from_slice(&plane[..start]);
        }
        ChoiceOrder {
            kind: ChoiceOrderKind::Policy,
            category: self.category.clone(),
            preferred,
            // No artifact revision and no generation time: nothing was generated. Reporting
            // the ranking's revision here would attribute the rule to a measurement.
            artifact: Some(POLICY_TIE_ORDER.to_string()),
            revision: None,
            generated_at: None,
        }
    }
}

/// Group the tie's members by plane, local first, each group in authored order.
fn tie_rotation(category: &str, rows: &[Candidate]) -> TieRotation {
    let mut ordered: Vec<&Candidate> = rows.iter().collect();
    ordered.sort_by_key(|r| (r.plane.as_deref() != Some("local"), r.sequence));

    let mut planes: Vec<Vec<ChoiceRef>> = Vec::new();
    let mut plane_open: Option<bool> = None;
    for row in ordered {
        let is_cloud = row.plane.as_deref() != Some("local");
        if plane_open != Some(is_cloud) {
            planes.push(Vec::new());
            plane_open = Some(is_cloud);
        }
        planes
            .last_mut()
            .expect("a group was just pushed")
            .push(ref_of(row));
    }

    TieRotation {
        category: category.to_string(),
        planes,
    }
}

/// A stable digest of the decision's question: FNV-1a over the goal's canonical JSON.
///
/// Any stable function would do; this one needs no dependency and no salt. `serde_json`'s
/// own rendering is canonical enough for the purpose — the map is ordered (sorted keys by
/// default), and a resumed drive rebuilds the same value from the same journal entry.
fn canonical(goal: &serde_json::Value) -> String {
    serde_json::to_string(goal).unwrap_or_default()
}

fn fnv1a(bytes: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Applies [`TieRotation`] to every decision a [`DecisionPlannerSelector`] makes.
///
/// The selector resolves its order ONCE, which is right for a measurement (a decision per
/// step would re-ask a question whose answer cannot change mid-run) and wrong for a turn:
/// a boot-time sequence over a tie sends every decision to the same member. So the part of
/// the rule that depends on the decision is applied here, by lending the selector a
/// dispatch that supplies this decision's order.
///
/// It supplies an order for a TIE only, and is only ever built for one — `Ordering::Tie` is
/// the sole caller. A measured order therefore never passes through this type, so nothing
/// here can replace evidence with a rule.
pub struct RotatingTieSelector {
    inner: DecisionPlannerSelector,
    rotation: TieRotation,
}

impl RotatingTieSelector {
    pub fn new(inner: DecisionPlannerSelector, rotation: TieRotation) -> Self {
        Self { inner, rotation }
    }
}

#[async_trait::async_trait]
impl PlannerSelector for RotatingTieSelector {
    async fn select(
        &self,
        goal: &serde_json::Value,
        candidates: &[AgentRef],
        dispatch: &dyn ModelDispatch,
    ) -> Result<AgentRef, OrchestratorError> {
        let rotating = RotatingDispatch {
            inner: dispatch,
            rotation: &self.rotation,
            goal,
        };
        self.inner.select(goal, candidates, &rotating).await
    }
}

/// The lent dispatch that replaces the selector's boot-time order with this decision's
/// rotation. `complete` passes straight through: the tie rule is about which model answers
/// a decision, not about what a text completion says.
struct RotatingDispatch<'a> {
    inner: &'a dyn ModelDispatch,
    rotation: &'a TieRotation,
    goal: &'a serde_json::Value,
}

#[async_trait::async_trait]
impl ModelDispatch for RotatingDispatch<'_> {
    async fn complete(
        &self,
        system: &str,
        user: &str,
        chain: Option<&str>,
    ) -> Result<String, OrchestratorError> {
        self.inner.complete(system, user, chain).await
    }

    async fn choose(
        &self,
        question: &ChoiceQuestion,
        chain: Option<&str>,
        // Deliberately ignored: the inner selector carries the boot-time sequence this
        // wrapper exists to replace (see [`RotatingTieSelector`]).
        _order: Option<&ChoiceOrder>,
    ) -> Result<ChoiceAnswer, OrchestratorError> {
        let order = self.rotation.order_for(self.goal);
        self.inner.choose(question, chain, Some(&order)).await
    }
}

/// The candidate refs for an ordered slice: router + API model, the pair a gateway candidate
/// answers to. The chain model name stands in when no active endpoint resolves.
fn refs(rows: &[&Candidate]) -> Vec<ChoiceRef> {
    rows.iter().map(|r| ref_of(r)).collect()
}

fn ref_of(row: &Candidate) -> ChoiceRef {
    ChoiceRef {
        router: Some(row.router.clone()),
        model: Some(row.api_model.clone().unwrap_or_else(|| row.model.clone())),
    }
}

/// Which selector this boot wires.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selector {
    /// The pure, spend-free default: a configured default planner, else the first
    /// candidate. Absent configuration must keep behaving exactly as before.
    Rule,
    /// One metered decision per `Select`, carrying the measured order (if any).
    Decision { chain: String, category: String },
}

/// Read the three variables. An unknown value is REFUSED rather than falling back: a typo
/// in `TORII_PLANNER_SELECTOR` that silently selected the rule path would leave an operator
/// believing a decision model is picking planners while it never runs.
pub fn selector_from(
    selector: Option<&str>,
    chain: Option<&str>,
    category: Option<&str>,
) -> Result<Selector, CliError> {
    fn non_empty(v: Option<&str>) -> Option<&str> {
        v.map(str::trim).filter(|v| !v.is_empty())
    }
    match non_empty(selector) {
        None | Some("rule") => Ok(Selector::Rule),
        Some("decision") => Ok(Selector::Decision {
            chain: non_empty(chain).unwrap_or(DEFAULT_CHAIN).to_string(),
            category: non_empty(category).unwrap_or(DEFAULT_CATEGORY).to_string(),
        }),
        Some(other) => Err(CliError::error(format!(
            "{ENV_SELECTOR}={other:?} is not a selector. Use `rule` (the default: no model \
             call, no ranking) or `decision` (one metered decision per planner selection)."
        ))),
    }
}

/// The smallest decision this port can ask: two options (a `choice` needs at least two)
/// with empty instructions, measured by the GATEWAY's own pessimistic estimator.
///
/// Deliberately not a copied constant: the plan's warning is that a number written here
/// drifts the first time the gateway's prompt overhead changes, and then a boot check
/// passes a chain whose calls the serving window refuses.
pub fn minimum_decision_tokens() -> u32 {
    let question = ChoiceQuestionShape::minimal();
    gateway::estimate_input_tokens_pessimistic(&question)
}

/// Kept apart from [`minimum_decision_tokens`] so the shape is visible: two keys, no
/// descriptions, no state. Anything a real menu adds only makes the requirement larger,
/// which is why this is a floor rather than a prediction.
struct ChoiceQuestionShape;

impl ChoiceQuestionShape {
    fn minimal() -> Payload {
        Payload::Decision {
            state: serde_json::json!({}),
            questions: DecisionQuestions::from([(
                "choice".to_string(),
                DecisionQuestion::Choice {
                    instructions: serde_json::json!(""),
                    criteria: [("a".to_string(), None::<String>), ("b".to_string(), None)]
                        .into_iter()
                        .collect(),
                },
            )]),
            images: Vec::new(),
            keep_alive: None,
        }
    }
}

/// Fail loud at boot when the configured chain cannot serve a decision: it does not exist,
/// it is not a `Decision` chain, a member model is unknown, or a member's window cannot
/// hold the smallest decision this port can ask.
///
/// All four are checked HERE because every alternative is worse: the run spends on the
/// expand, then dies mid-flight; or the catalog's invented window yields a 400 from a
/// provider; or a ranking measured for one task orders a different one.
pub fn require_decision_chain(
    gw: &GatewayConfig,
    chain: &str,
    category: &str,
) -> Result<(), CliError> {
    let Some(config) = gw.chains.get(chain) else {
        let mut decision_chains: Vec<&String> = gw
            .chains
            .iter()
            .filter(|(_, c)| c.capability == Capability::Decision)
            .map(|(name, _)| name)
            .collect();
        decision_chains.sort();
        let available = if decision_chains.is_empty() {
            "this gateway config defines none".to_string()
        } else {
            decision_chains
                .iter()
                .map(|c| format!("{c:?}"))
                .collect::<Vec<_>>()
                .join(", ")
        };
        return Err(CliError::error(format!(
            "{ENV_CHAIN}={chain:?} is not a chain in this gateway config, so every planner \
             decision would fail with no candidates. Decision chains available: {available}."
        )));
    };

    if config.capability != Capability::Decision {
        return Err(CliError::error(format!(
            "{ENV_CHAIN}={chain:?} is a {:?} chain, not a decision chain, so a planner \
             decision sent to it would be refused as an unsupported capability. Use a chain \
             serving Capability::Decision.",
            config.capability
        )));
    }

    let minimum = minimum_decision_tokens();
    for entry in &config.models {
        let Some(model) = gw.models.get(&entry.model) else {
            return Err(CliError::error(format!(
                "chain {chain:?} names model {:?}, which this gateway config does not define. \
                 A decision call could never reach it, and the ranking measured for \
                 {category:?} may not be about a model that exists here.",
                entry.model
            )));
        };
        if model.context_window < minimum {
            return Err(CliError::error(format!(
                "chain {chain:?} member {:?} has a {}-token window, but the smallest decision \
                 this port can ask needs {minimum} tokens (two options, gateway-estimated). A \
                 planner selection on it would fail the gateway's window gate after the run had \
                 already spent.",
                entry.model, model.context_window
            )));
        }
    }
    Ok(())
}

/// The resolver seam: one call per run per category, over whatever backend has the catalog.
///
/// A trait rather than a pool field so the memory backend (no catalog, no measurements)
/// simply carries `None`, exactly as it does for the gateway config.
#[async_trait::async_trait]
pub trait RankingResolver: Send + Sync {
    async fn resolve(&self, chain: &str, category: &str) -> Result<Snapshot, String>;
}

/// Torii's catalog, read as the tenant's own chain rows.
pub struct CatalogRanking {
    pool: PgPool,
    tenant: Uuid,
}

impl CatalogRanking {
    pub fn new(pool: PgPool, tenant: Uuid) -> Self {
        Self { pool, tenant }
    }
}

#[async_trait::async_trait]
impl RankingResolver for CatalogRanking {
    async fn resolve(&self, chain: &str, category: &str) -> Result<Snapshot, String> {
        // One statement for the chain, its measurements and the margin in force: reading
        // them separately could compose an order from two different edits (§8.1b).
        let rows = sqlx::query(
            "select chain_name, model_full_name, router_name, router_model_id, sequence_order,
                    rank, verdict::text as verdict, within_margin, revision, generated_at,
                    plane::text as plane
               from catalog.ranked_chain($1, $2, $3)",
        )
        .bind(self.tenant)
        .bind(DECISION_CAPABILITY)
        .bind(category)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("catalog.ranked_chain({category}): {e}"))?;

        // The function's grain is (tenant, capability, category); a boot's chain is the one
        // it will actually call, so rows from a sibling decision chain are not this order.
        let candidates: Vec<Candidate> = rows
            .iter()
            .filter(|row| row.get::<String, _>("chain_name") == chain)
            .map(|row| Candidate {
                model: row.get("model_full_name"),
                router: row.get("router_name"),
                plane: row.get("plane"),
                api_model: row.get("router_model_id"),
                sequence: row.get("sequence_order"),
                rank: row.get("rank"),
                verdict: row.get("verdict"),
                within_margin: row.get("within_margin"),
                revision: row.get("revision"),
                generated_at: row
                    .get::<Option<chrono::DateTime<chrono::Utc>>, _>("generated_at")
                    .map(|t| t.timestamp()),
            })
            .collect();

        Ok(compose(category, &candidates))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn candidate(model: &str, sequence: i32, rank: Option<i32>, within: Option<bool>) -> Candidate {
        Candidate {
            model: model.to_string(),
            router: "ollama".to_string(),
            plane: Some("cloud".to_string()),
            api_model: Some(model.to_string()),
            sequence,
            rank,
            verdict: Some("winner".to_string()),
            within_margin: within,
            revision: Some(3),
            generated_at: Some(1_760_000_000),
        }
    }

    /// A winner's admissible rows become the order, in RANK order rather than chain order,
    /// and the model the margin excluded is reported without being sent.
    #[test]
    fn a_winner_orders_only_the_admissible_rows_in_rank_order() {
        let rows = vec![
            // Authored order is nimble → strands-decider → laya; measurement reverses two.
            candidate("nimble", 1, Some(2), Some(true)),
            candidate("strands-decider", 2, Some(1), Some(true)),
            candidate("laya", 3, Some(3), Some(false)),
        ];
        let snapshot = compose(DEFAULT_CATEGORY, &rows);

        let Some(Ordering::Measured(order)) = snapshot.ordering else {
            panic!("a winner sends a measured order");
        };
        assert_eq!(order.category, DEFAULT_CATEGORY);
        assert_eq!(order.artifact.as_deref(), Some(ARTIFACT));
        assert_eq!(order.revision, Some(3));
        assert_eq!(order.generated_at, Some(1_760_000_000));
        assert_eq!(
            order
                .preferred
                .iter()
                .map(|r| r.model.clone().unwrap_or_default())
                .collect::<Vec<_>>(),
            vec!["strands-decider".to_string(), "nimble".to_string()],
            "rank order, and only the rows the margin admitted"
        );
        assert_eq!(snapshot.admissible, 2);
        assert_eq!(snapshot.chained, 3);
        assert_eq!(
            snapshot.filtered,
            vec!["laya".to_string()],
            "an excluded model is reported, not ranked"
        );
        assert_eq!(snapshot.verdict.as_deref(), Some("winner"));
    }

    /// A measured tie: one local model and two cloud ones, all scored the same.
    fn tie_rows() -> Vec<Candidate> {
        let mut rows = vec![
            candidate("nimble", 1, None, None),
            candidate("strands-decider", 2, None, None),
            candidate("local-decider", 3, None, None),
        ];
        for row in &mut rows {
            row.verdict = Some("tie".to_string());
        }
        rows[2].plane = Some("local".to_string());
        rows
    }

    /// A tie is a measured SET with no order to claim, so it is broken by a rule — local
    /// models before cloud ones, with a turn inside each plane — and the result is an
    /// AUTHORED order, never a measurement: no artifact revision, no generation time.
    #[test]
    fn a_tie_is_broken_local_first_as_an_authored_order() {
        let snapshot = compose(DEFAULT_CATEGORY, &tie_rows());
        let Some(Ordering::Tie(tie)) = snapshot.ordering.clone() else {
            panic!("a tie is broken by the policy");
        };
        assert_eq!(tie.planes.len(), 2, "one group per plane, local first");
        assert_eq!(
            tie.planes[0]
                .iter()
                .map(|r| r.model.clone().unwrap_or_default())
                .collect::<Vec<_>>(),
            vec!["local-decider".to_string()],
            "the local plane is its own group, ahead of the cloud one"
        );

        let order = tie.order_for(&serde_json::json!({ "goal": "pick a planner" }));
        assert_eq!(order.kind, ChoiceOrderKind::Policy);
        assert_eq!(order.artifact.as_deref(), Some(POLICY_TIE_ORDER));
        assert_eq!(
            order.revision, None,
            "nothing measured it, so no artifact revision is claimed"
        );
        assert_eq!(order.generated_at, None);
        assert_eq!(
            order.preferred.first().and_then(|r| r.model.clone()),
            Some("local-decider".to_string()),
            "local first, whatever the turn lands on"
        );
        assert!(
            snapshot.reason.contains("tie"),
            "the reason still reports the tie that caused it: {}",
            snapshot.reason
        );
        assert!(
            snapshot.describe().contains(POLICY_TIE_ORDER)
                && snapshot.describe().contains("no measurement claimed")
                && snapshot.describe().contains("rotating per decision"),
            "the boot line must not read as a measurement: {}",
            snapshot.describe()
        );
    }

    /// The turn is a function of the question and nothing else: one decision always replays
    /// to the same order (its memo key contains that order), while different decisions start
    /// the cloud plane at different members. Rotation moves the start, never the membership,
    /// and never across the local/cloud boundary.
    #[test]
    fn the_turn_is_taken_by_the_question_and_is_stable_for_it() {
        let snapshot = compose(DEFAULT_CATEGORY, &tie_rows());
        let Some(Ordering::Tie(tie)) = snapshot.ordering else {
            panic!("a tie is broken by the policy");
        };

        let mut cloud_firsts = std::collections::BTreeSet::new();
        for i in 0..32 {
            let goal = serde_json::json!({ "goal": format!("task {i}") });
            let order = tie.order_for(&goal);
            assert_eq!(
                order,
                tie.order_for(&goal),
                "the same question must get the same order"
            );

            let names: Vec<String> = order
                .preferred
                .iter()
                .filter_map(|r| r.model.clone())
                .collect();
            assert_eq!(
                names.len(),
                3,
                "rotation never drops or duplicates a member"
            );
            assert_eq!(names[0], "local-decider", "the local plane stays first");
            cloud_firsts.insert(names[1].clone());
        }
        assert_eq!(
            cloud_firsts.len(),
            2,
            "both cloud members take the first cloud slot across decisions: {cloud_firsts:?}"
        );
    }

    /// Records the order each decision was asked to run under and answers a fixed key.
    #[derive(Default)]
    struct OrderRecording {
        seen: std::sync::Mutex<Vec<Option<ChoiceOrder>>>,
    }

    #[async_trait::async_trait]
    impl ModelDispatch for OrderRecording {
        async fn complete(
            &self,
            _system: &str,
            _user: &str,
            _chain: Option<&str>,
        ) -> Result<String, OrchestratorError> {
            Err(OrchestratorError::Gateway(
                "the tie rule is about decisions, not text".into(),
            ))
        }

        async fn choose(
            &self,
            _question: &ChoiceQuestion,
            _chain: Option<&str>,
            order: Option<&ChoiceOrder>,
        ) -> Result<ChoiceAnswer, OrchestratorError> {
            self.seen.lock().expect("order lock").push(order.cloned());
            Ok(ChoiceAnswer {
                choice: "alpha".into(),
                confidence: 0.5,
            })
        }
    }

    /// The wrapper is what makes the turn reach the wire: the inner selector's boot-time
    /// order is replaced by THIS decision's rotation, so a resolved-once snapshot does not
    /// send every decision to the same member.
    #[tokio::test]
    async fn the_rotating_selector_sends_this_decisions_order() {
        let snapshot = compose(DEFAULT_CATEGORY, &tie_rows());
        let Some(Ordering::Tie(rotation)) = snapshot.ordering else {
            panic!("a tie is broken by the policy");
        };
        let selector = RotatingTieSelector::new(
            DecisionPlannerSelector::new(
                std::sync::Arc::new(orchestrator_core::Registry::default()),
                "decide",
            ),
            rotation.clone(),
        );
        let candidates = [AgentRef("alpha".into()), AgentRef("beta".into())];
        let goal = serde_json::json!({ "goal": "task 7" });
        let dispatch = OrderRecording::default();

        selector
            .select(&goal, &candidates, &dispatch)
            .await
            .expect("a tie orders the menu, it does not refuse it");

        assert_eq!(
            dispatch.seen.lock().expect("order lock").as_slice(),
            &[Some(rotation.order_for(&goal))],
            "the decision goes out under this question's turn"
        );
    }

    /// A tie over a single model has nothing to order — the policy needs at least two names
    /// before it means anything.
    #[test]
    fn a_tie_over_one_model_still_sends_nothing() {
        let mut rows = vec![candidate("nimble", 1, None, None)];
        rows[0].verdict = Some("tie".to_string());
        let snapshot = compose(DEFAULT_CATEGORY, &rows);
        assert!(snapshot.ordering.is_none());
        assert!(snapshot.reason.contains("tie"), "{}", snapshot.reason);
    }

    /// One admissible model is not an order — the gateway's stable re-rank over a single
    /// name would be a no-op that still claimed to have ranked.
    #[test]
    fn a_single_admissible_model_is_not_ordered() {
        let rows = vec![
            candidate("nimble", 1, Some(1), Some(true)),
            candidate("laya", 2, Some(2), Some(false)),
        ];
        let snapshot = compose(DEFAULT_CATEGORY, &rows);
        assert!(snapshot.ordering.is_none());
        assert!(
            snapshot.reason.contains("fewer than 2"),
            "{}",
            snapshot.reason
        );
    }

    /// No measurement at all (an unmeasured category, or a chain with no rows) is a normal
    /// state with its own reason, never an error.
    #[test]
    fn no_measurement_and_no_chain_each_get_their_own_reason() {
        let unmeasured = vec![Candidate {
            verdict: None,
            rank: None,
            within_margin: None,
            revision: None,
            ..candidate("nimble", 1, None, None)
        }];
        let snapshot = compose(DEFAULT_CATEGORY, &unmeasured);
        assert!(snapshot.ordering.is_none());
        assert!(
            snapshot.reason.contains("no measurement"),
            "{}",
            snapshot.reason
        );

        let empty = compose(DEFAULT_CATEGORY, &[]);
        assert!(empty.ordering.is_none());
        assert_eq!(empty.chained, 0);
        assert!(empty.reason.contains("no models"), "{}", empty.reason);
    }

    /// The absent selector keeps the shipped behaviour; `decision` takes the documented
    /// defaults; a typo is refused rather than silently becoming the rule path.
    #[test]
    fn the_selector_variable_defaults_to_rules_and_refuses_a_typo() {
        assert_eq!(selector_from(None, None, None).unwrap(), Selector::Rule);
        assert_eq!(
            selector_from(Some("  "), None, None).unwrap(),
            Selector::Rule
        );
        assert_eq!(
            selector_from(Some("rule"), Some("decide"), Some("x")).unwrap(),
            Selector::Rule,
            "an explicit `rule` is the default path, not a decision with the rule's name"
        );
        assert_eq!(
            selector_from(Some("decision"), None, None).unwrap(),
            Selector::Decision {
                chain: DEFAULT_CHAIN.to_string(),
                category: DEFAULT_CATEGORY.to_string(),
            }
        );
        assert_eq!(
            selector_from(Some("decision"), Some("decide-2"), Some("tool.route")).unwrap(),
            Selector::Decision {
                chain: "decide-2".to_string(),
                category: "tool.route".to_string(),
            }
        );
        let err = selector_from(Some("decisoin"), None, None).unwrap_err();
        assert!(
            err.message.contains("decisoin"),
            "a refusal must name the offending value: {}",
            err.message
        );
    }

    fn gw_with(chain: &str, capability: Capability, window: u32) -> GatewayConfig {
        use kernel::types::config::{ChainEntry, FallbackChainConfig, ModelConfig};

        let mut models = HashMap::new();
        models.insert(
            "m".to_string(),
            ModelConfig {
                id: "m".to_string(),
                api_model_id: None,
                provider: "ollama".to_string(),
                capabilities: vec![capability.clone()],
                context_window: window,
                max_output_tokens: 512,
                pricing: None,
                family: None,
                catalog: None,
            },
        );
        let mut chains = HashMap::new();
        chains.insert(
            chain.to_string(),
            FallbackChainConfig {
                id: chain.to_string(),
                capability,
                models: vec![ChainEntry {
                    model: "m".to_string(),
                    router: None,
                    api_model_id: None,
                    priority: 0,
                }],
                fallback_triggers: Vec::new(),
            },
        );
        GatewayConfig {
            chains,
            models,
            ..Default::default()
        }
    }

    /// The heavy tier's zero-adapter stance: an undersized window refuses at boot, naming
    /// BOTH numbers, rather than taking a provider 400 after the run has spent.
    #[test]
    fn an_undersized_window_refuses_at_boot_naming_both_numbers() {
        let minimum = minimum_decision_tokens();
        assert!(minimum > 0, "the estimator answers something");

        let gw = gw_with(DEFAULT_CHAIN, Capability::Decision, minimum - 1);
        let err = require_decision_chain(&gw, DEFAULT_CHAIN, DEFAULT_CATEGORY).unwrap_err();
        assert!(
            err.message.contains(&(minimum - 1).to_string())
                && err.message.contains(&minimum.to_string()),
            "the refusal must name both the window and the requirement: {}",
            err.message
        );

        let ok = gw_with(DEFAULT_CHAIN, Capability::Decision, minimum + 1);
        require_decision_chain(&ok, DEFAULT_CHAIN, DEFAULT_CATEGORY)
            .expect("a window that holds the minimum decision boots");
    }

    /// A chat chain is not a decision chain, and a missing chain names the ones that exist:
    /// both mistakes that would otherwise surface as a failed run.
    #[test]
    fn a_missing_or_misplaced_chain_is_refused_by_name() {
        let gw = gw_with("chat", Capability::TextChat, 200_000);

        let missing = require_decision_chain(&gw, DEFAULT_CHAIN, DEFAULT_CATEGORY).unwrap_err();
        assert!(missing.message.contains("\"decide\""));
        assert!(
            missing.message.contains("none"),
            "no decision chain exists here, and the message says so: {}",
            missing.message
        );

        let wrong = require_decision_chain(&gw, "chat", DEFAULT_CATEGORY).unwrap_err();
        assert!(
            wrong.message.contains("not a decision chain"),
            "{}",
            wrong.message
        );
    }

    /// The real query, against the seeded catalog: the `decide` chain comes back through
    /// `ranked_chain`, every row carries the endpoint the order would name, and a tie
    /// yields no order — proving the SQL and the mapping, not just [`compose`].
    #[tokio::test]
    #[cfg_attr(
        not(have_database_url),
        ignore = "needs a Postgres at $DATABASE_URL; see README, Postgres-backed tests"
    )]
    async fn the_resolver_reads_the_seeded_decide_chain() {
        let Some(url) = crate::test_guard::db_url() else {
            return;
        };
        let pool = torii_core::connect(&url, 4).await.expect("connect");
        // The platform tenant owns the catalog's own chains.
        let resolver = CatalogRanking::new(pool, Uuid::nil());

        let snapshot = resolver
            .resolve(DEFAULT_CHAIN, DEFAULT_CATEGORY)
            .await
            .expect("the resolver reads the catalog");
        assert!(
            snapshot.chained >= 2,
            "the seeded decide chain has members: {snapshot:?}"
        );
        for row in &snapshot.filtered {
            assert!(!row.is_empty());
        }
        // Seeded measurements are a tie, so the ordering is the local-first POLICY with its
        // per-decision turn — a rule with no artifact behind it — not a measured ranking.
        let Some(Ordering::Tie(tie)) = snapshot.ordering.as_ref() else {
            panic!("the seeded tie is broken by the policy");
        };
        let order = tie.order_for(&serde_json::json!({ "goal": "seeded" }));
        assert_eq!(order.kind, ChoiceOrderKind::Policy);
        assert_eq!(
            order.preferred.len(),
            snapshot.chained,
            "the policy orders every chain member, not a measured subset"
        );
        assert!(
            order.revision.is_none() && order.generated_at.is_none(),
            "a policy order claims no artifact: {order:?}"
        );

        // An unmeasured category is not an empty result: `ranked_chain` returns the chain's
        // rows regardless and leaves the measurement columns NULL, so the resolver reports
        // the chain it saw and sends no order. Silently returning nothing here would make
        // "unmeasured" indistinguishable from "this chain does not exist".
        let unknown = resolver
            .resolve(DEFAULT_CHAIN, "no.such.category")
            .await
            .expect("an unmeasured category is not an error");
        assert_eq!(
            unknown.chained, snapshot.chained,
            "the chain's rows come back even when nothing was measured"
        );
        assert!(unknown.ordering.is_none());
        assert!(
            unknown.reason.contains("no measurement"),
            "{}",
            unknown.reason
        );
    }
}
