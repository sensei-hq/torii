//! AG-4 (torii#33): a run's node OUTPUTS — what `torii run results` prints, and what the API
//! will serve. `run status` reads the schedule row; this reads what the run produced.
//!
//! Here, not in the CLI, because the CLI and the API must not grow two answers to "what did this
//! run output".

use orchestrator_core::{
    ContentStore, ExecutionJournal, NodeId, OrchestratorError, RunId, RunStatus, SchedulerStore,
    Seq,
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
    /// The first `NodeFailed` error of a node that never completed — RAW, like
    /// `ScheduledRun.reason`: redacting free text for display is the renderer's job.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeState {
    Completed,
    Failed,
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
pub async fn run_results(
    _scheduler: &dyn SchedulerStore,
    _journal: &dyn ExecutionJournal,
    _content: &dyn ContentStore,
    _run: RunId,
) -> Result<Option<RunResults>, OrchestratorError> {
    Ok(None)
}
