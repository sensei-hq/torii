//! AG-4 (torii#33): a run's node OUTPUTS — what `torii run results` prints, and what the API
//! will serve. `run status` reads the schedule row; this reads what the run produced.
//!
//! Here, not in the CLI, because the CLI and the API must not grow two answers to "what did this
//! run output".

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::LazyLock;

use orchestrator_core::{
    ContentStore, EffectOutput, ExecutionJournal, JournalEvent, NodeId, OrchestratorError,
    PatternRedactor, Redactor, RunId, RunStatus, SchedulerStore, Seq,
};
use serde::Serialize;

/// One run's node outputs.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RunResults {
    pub run: RunId,
    /// The schedule row's status — the same one `run status` shows.
    pub status: RunStatus,
    /// The journal position the outputs were checkpointed at; `None` when the run has no
    /// checkpoint yet (never driven, or a backend that keeps none).
    pub as_of: Option<Seq>,
    /// Every node with a result, ordered by node id.
    pub nodes: Vec<NodeResult>,
}

/// One node's result.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NodeResult {
    pub node: NodeId,
    pub state: NodeState,
    /// Where the output lives in durable storage; `None` when the node has no output.
    pub stored: Option<Stored>,
    /// The output, redacted. `None` when the node has none, or when it could not be resolved.
    pub output: Option<serde_json::Value>,
    /// Why a CAS-stored output could not be read back.
    pub unresolved: Option<String>,
    /// The LAST `NodeFailed` error of a node with no later completion — the one it stopped on,
    /// the same text `ScheduledRun.reason` carries for a run that failed on it (or, while
    /// `Retrying`, the pending retry's notice). RAW, like `ScheduledRun.reason`: redacting free
    /// text for display is the renderer's job.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeState {
    Completed,
    Failed,
    /// Its last attempt failed transiently and the run is paused until the retry; `error` is the
    /// retry notice. Only on a run that is not terminal — on a terminal one nothing will retry
    /// it, and it is `Failed`.
    Retrying,
    Skipped,
}

/// How a node's output is stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Stored {
    /// Carried in the checkpoint row itself.
    Inline,
    /// Over the executor's CAS threshold: a ref into the tenant's content store.
    Cas { digest: String, size: usize },
}

/// The run's node outputs, or `None` when THIS tenant has no such run.
///
/// **Not-found is the schedule row.** Every store passed in is scoped to one tenant, so another
/// tenant's run reads exactly like a run that never existed — the same `None`, before the journal
/// or the CAS is touched. Nothing here distinguishes "not yours" from "not there".
///
/// **The outputs are the executor's own checkpoint, not a torii re-derivation.** At every round
/// boundary the executor writes a [`Snapshot`](orchestrator_core::Snapshot) of its drive
/// outcome — the completed and skipped nodes and each node's output, split into the CAS when it
/// is over `cas_threshold` — and that is the value a resume seeds from. It is the only durable
/// carrier of the CANONICAL output: the journal's `EffectRecorded` rows hold an `Agent` node's
/// raw last turn (`{model, text, tool_calls}`, not the `{model, text}` it returns), and nothing
/// at all for a node a human answered (`AwaitSignal`, a `HumanGate`, a human-backed `Agent`),
/// whose output the executor folds from the decision. The gateway's own journal fold
/// (`fold_journal`) is crate-private; re-deriving it here would be a second answer to "what did
/// this node output" that could only drift.
///
/// **The journal is folded for what the checkpoint does not carry:** a node's failure. The LAST
/// `NodeFailed` per node is its error (see [`fold_failures`]): under transient retry the earlier
/// rows are "retrying" notices, and the last is what `run status` reports. A node the checkpoint
/// lists as completed, or with a later `NodeCompleted` in the journal, carries none (it failed,
/// was retried and completed). A node whose last failure is a pending transient retry is
/// `Retrying` while the run is not terminal.
///
/// A CAS ref is resolved through `content` — the tenant's CAS — and a ref that cannot be read
/// back is reported on its node (`unresolved`) rather than failing the whole read, so one lost
/// blob does not hide every other output. Every resolved output passes the executor's
/// `PatternRedactor` once more before it is returned: idempotent on what the executor already
/// scrubbed, and a second line for anything written before it did.
pub async fn run_results(
    scheduler: &dyn SchedulerStore,
    journal: &dyn ExecutionJournal,
    content: &dyn ContentStore,
    run: RunId,
) -> Result<Option<RunResults>, OrchestratorError> {
    let Some(row) = scheduler.status(run).await? else {
        return Ok(None);
    };
    let events = journal
        .load(run)
        .await
        .map_err(OrchestratorError::Journal)?;
    let snapshot = journal
        .latest_snapshot(run)
        .await
        .map_err(OrchestratorError::Journal)?;

    let failures = fold_failures(&events);

    let mut rows: BTreeMap<String, NodeResult> = BTreeMap::new();
    let blank = |node: &NodeId, state: NodeState| NodeResult {
        node: node.clone(),
        state,
        stored: None,
        output: None,
        unresolved: None,
        error: None,
    };
    let as_of = snapshot.as_ref().map(|s| s.seq);
    let mut completed: HashSet<NodeId> = HashSet::new();
    if let Some(snap) = snapshot {
        completed.extend(snap.completed.iter().cloned());
        for node in &snap.completed {
            rows.insert(node.0.clone(), blank(node, NodeState::Completed));
        }
        for node in &snap.skipped {
            rows.entry(node.0.clone())
                .or_insert_with(|| blank(node, NodeState::Skipped));
        }
        for (node, output) in &snap.outputs {
            // An output on a node the checkpoint does not list as completed is a FAILED node's
            // (a `Map`'s manifest is kept on failure) — the failure fold below marks it.
            let r = rows
                .entry(node.0.clone())
                .or_insert_with(|| blank(node, NodeState::Completed));
            match output {
                EffectOutput::Inline(v) => {
                    r.stored = Some(Stored::Inline);
                    r.output = Some(REDACTOR.redact(v));
                }
                EffectOutput::Ref(cref) => {
                    r.stored = Some(Stored::Cas {
                        digest: cref.digest.0.clone(),
                        size: cref.size,
                    });
                    match resolve(content, &cref.digest).await {
                        Ok(v) => r.output = Some(REDACTOR.redact(&v)),
                        Err(e) => r.unresolved = Some(e.to_string()),
                    }
                }
            }
        }
    }
    let retry_pending = !row.status.is_terminal();
    for (node, failure) in failures {
        if completed.contains(&node) {
            continue;
        }
        let (state, error) = match failure {
            Failure::Retrying(e) if retry_pending => (NodeState::Retrying, e),
            Failure::Retrying(e) | Failure::Failed(e) => (NodeState::Failed, e),
        };
        let r = rows
            .entry(node.0.clone())
            .or_insert_with(|| blank(&node, state));
        r.state = state;
        r.error = Some(error);
    }

    Ok(Some(RunResults {
        run,
        status: row.status,
        as_of,
        nodes: rows.into_values().collect(),
    }))
}

/// The executor's redactor, built once (it compiles a regex set).
static REDACTOR: LazyLock<PatternRedactor> = LazyLock::new(PatternRedactor::default);

/// Where a node's failures left it, by the journal alone.
enum Failure {
    /// Its last attempt failed, and that failure is the one it stopped on.
    Failed(String),
    /// Its last attempt failed transiently and the run paused for the retry: the executor's
    /// retry shape is a `NodeFailed` followed by a `RunPaused` carrying the same reason and a
    /// `resume_after` — the wake the node re-attempts on.
    Retrying(String),
}

/// Each node's LAST failure, in journal order, unless a later `NodeCompleted` superseded it.
///
/// Last, not first: under transient retry a node appends one `NodeFailed` per attempt, and every
/// one but the last is a "retrying (attempt k of N)" notice — the terminal error, the one
/// `ScheduledRun.reason` carries, is the final row. A `NodeCompleted` clears the failure: it is
/// the only record of a namespaced inner node (`sub/x`) that failed, retried and completed,
/// since the outer checkpoint lists only `sub`.
fn fold_failures(events: &[(Seq, JournalEvent)]) -> HashMap<NodeId, Failure> {
    let mut failures: HashMap<NodeId, Failure> = HashMap::new();
    for (_, event) in events {
        match event {
            JournalEvent::NodeFailed { node, error } => {
                failures.insert(node.clone(), Failure::Failed(error.clone()));
            }
            JournalEvent::NodeCompleted { node } => {
                failures.remove(node);
            }
            JournalEvent::RunPaused {
                reason,
                resume_after: Some(_),
            } => {
                for failure in failures.values_mut() {
                    if let Failure::Failed(e) = failure {
                        if e == reason {
                            *failure = Failure::Retrying(std::mem::take(e));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    failures
}

async fn resolve(
    content: &dyn ContentStore,
    digest: &orchestrator_core::Digest,
) -> Result<serde_json::Value, OrchestratorError> {
    let bytes = content.get(digest).await?;
    Ok(serde_json::from_slice(&bytes)?)
}
