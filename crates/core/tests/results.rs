//! AG-4 (torii#33): `run_results` — a run's node outputs, from the executor's own checkpoint,
//! with CAS refs resolved through the content store. DB-free: the gateway's in-memory stores
//! implement the same traits torii's Postgres stores do (the tenant scoping is proven at the
//! binary, in `crates/cli/tests/postgres_backend.rs`).

use gateway_store::{InMemoryContentStore, InMemoryJournal, InMemorySchedulerStore};
use orchestrator_core::{
    ContentRef, ContentStore, Digest, EffectOutput, ExecutionJournal, Graph, JournalEvent, NodeId,
    RunId, RunStatus, SchedulerStore, Snapshot,
};
use serde_json::json;
use torii_core::results::{run_results, NodeResult, NodeState, Stored};

fn n(id: &str) -> NodeId {
    NodeId(id.into())
}

struct Fixture {
    scheduler: InMemorySchedulerStore,
    journal: InMemoryJournal,
    content: InMemoryContentStore,
    run: RunId,
}

impl Fixture {
    async fn new() -> Fixture {
        let f = Fixture {
            scheduler: InMemorySchedulerStore::new(),
            journal: InMemoryJournal::new(),
            content: InMemoryContentStore::new(),
            run: RunId(uuid::Uuid::new_v4()),
        };
        f.scheduler
            .enqueue(f.run, &Graph { nodes: vec![] }, chrono::Utc::now())
            .await
            .unwrap();
        f
    }

    async fn append(&self, e: JournalEvent) -> u64 {
        self.journal.append(self.run, e).await.unwrap()
    }

    async fn results(&self) -> Option<torii_core::results::RunResults> {
        run_results(&self.scheduler, &self.journal, &self.content, self.run)
            .await
            .expect("results")
    }
}

fn row<'a>(nodes: &'a [NodeResult], id: &str) -> &'a NodeResult {
    nodes
        .iter()
        .find(|r| r.node.0 == id)
        .unwrap_or_else(|| panic!("no row for {id}: {nodes:?}"))
}

#[tokio::test]
async fn an_unknown_run_is_none() {
    let f = Fixture::new().await;
    let other = RunId(uuid::Uuid::new_v4());
    let got = run_results(&f.scheduler, &f.journal, &f.content, other)
        .await
        .unwrap();
    assert_eq!(got, None);
}

#[tokio::test]
async fn a_completed_runs_outputs_come_back_inline_cas_failed_and_skipped() {
    let f = Fixture::new().await;
    f.append(JournalEvent::RunStarted {
        version: "v1".into(),
        budget: None,
        money_budget: None,
    })
    .await;
    f.append(JournalEvent::NodeFailed {
        node: n("b"),
        error: "first failure".into(),
    })
    .await;
    f.append(JournalEvent::NodeFailed {
        node: n("b"),
        error: "second failure".into(),
    })
    .await;
    // `r` failed once and was retried to completion: completed wins, no error.
    f.append(JournalEvent::NodeFailed {
        node: n("r"),
        error: "transient".into(),
    })
    .await;
    let seq = f.append(JournalEvent::NodeCompleted { node: n("r") }).await;

    let big = json!({ "text": "x".repeat(5000) });
    let bytes = serde_json::to_vec(&big).unwrap();
    let digest = f.content.put(&bytes).await.unwrap();
    f.journal
        .snapshot(
            f.run,
            Snapshot {
                seq,
                completed: vec![n("c"), n("a"), n("r")],
                skipped: vec![n("d")],
                outputs: vec![
                    (
                        n("a"),
                        EffectOutput::Inline(json!({ "decision": "approved" })),
                    ),
                    (
                        n("c"),
                        EffectOutput::Ref(ContentRef {
                            digest: digest.clone(),
                            size: bytes.len(),
                            summary: None,
                        }),
                    ),
                    (n("r"), EffectOutput::Inline(json!("ok"))),
                ],
                ..Snapshot::default()
            },
        )
        .await
        .unwrap();
    f.append(JournalEvent::RunCompleted).await;
    f.scheduler
        .record_terminal(f.run, RunStatus::Completed, None)
        .await
        .unwrap();

    let got = f.results().await.expect("the run exists");
    assert_eq!(got.run, f.run);
    assert_eq!(got.status, RunStatus::Completed);
    assert_eq!(got.as_of, Some(seq));
    let ids: Vec<&str> = got.nodes.iter().map(|r| r.node.0.as_str()).collect();
    assert_eq!(ids, ["a", "b", "c", "d", "r"], "ordered by node id");

    let a = row(&got.nodes, "a");
    assert_eq!(a.state, NodeState::Completed);
    assert_eq!(a.stored, Some(Stored::Inline));
    assert_eq!(a.output, Some(json!({ "decision": "approved" })));

    let b = row(&got.nodes, "b");
    assert_eq!(b.state, NodeState::Failed);
    assert_eq!(
        b.error.as_deref(),
        Some("second failure"),
        "the LAST failure is the one the node stopped on"
    );
    assert_eq!((b.stored.clone(), b.output.clone()), (None, None));

    let c = row(&got.nodes, "c");
    assert_eq!(c.state, NodeState::Completed);
    assert_eq!(
        c.stored,
        Some(Stored::Cas {
            digest: digest.0.clone(),
            size: bytes.len()
        })
    );
    assert_eq!(c.output, Some(big), "the CAS ref is resolved to its value");
    assert_eq!(c.unresolved, None);

    let d = row(&got.nodes, "d");
    assert_eq!(d.state, NodeState::Skipped);
    assert_eq!(d.output, None);

    let r = row(&got.nodes, "r");
    assert_eq!(r.state, NodeState::Completed);
    assert_eq!(
        r.error, None,
        "a node that later completed carries no error"
    );
}

#[tokio::test]
async fn an_output_is_redacted_before_it_is_returned() {
    let f = Fixture::new().await;
    let secret = format!("sk-{}", "A".repeat(30));
    // `c` is over the CAS threshold: the largest outputs, the ones `--node` prints whole, and
    // the ones whose second redaction pass runs on the value read back from the content store.
    let big = json!({ "text": format!("{} {secret}", "x".repeat(5000)) });
    let bytes = serde_json::to_vec(&big).unwrap();
    let digest = f.content.put(&bytes).await.unwrap();
    f.journal
        .snapshot(
            f.run,
            Snapshot {
                seq: 0,
                completed: vec![n("a"), n("c")],
                outputs: vec![
                    (n("a"), EffectOutput::Inline(json!({ "text": secret }))),
                    (
                        n("c"),
                        EffectOutput::Ref(ContentRef {
                            digest,
                            size: bytes.len(),
                            summary: None,
                        }),
                    ),
                ],
                ..Snapshot::default()
            },
        )
        .await
        .unwrap();
    let got = f.results().await.unwrap();
    for id in ["a", "c"] {
        let text = row(&got.nodes, id).output.as_ref().unwrap()["text"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!text.contains(&secret), "{id}: {text}");
        assert!(text.contains("[REDACTED]"), "{id}: {text}");
    }
}

#[tokio::test]
async fn a_ref_the_content_store_lacks_is_unresolved_not_an_error() {
    let f = Fixture::new().await;
    f.journal
        .snapshot(
            f.run,
            Snapshot {
                seq: 0,
                completed: vec![n("a"), n("b")],
                outputs: vec![
                    (
                        n("a"),
                        EffectOutput::Ref(ContentRef {
                            digest: Digest("0".repeat(64)),
                            size: 9000,
                            summary: None,
                        }),
                    ),
                    (n("b"), EffectOutput::Inline(json!(1))),
                ],
                ..Snapshot::default()
            },
        )
        .await
        .unwrap();
    let got = f.results().await.unwrap();
    let a = row(&got.nodes, "a");
    assert_eq!(a.output, None);
    assert!(
        a.unresolved
            .as_deref()
            .is_some_and(|e| e.contains(&"0".repeat(64))),
        "{a:?}"
    );
    assert_eq!(
        row(&got.nodes, "b").output,
        Some(json!(1)),
        "the rest still resolve"
    );
}

#[tokio::test]
async fn a_run_with_no_checkpoint_reports_its_failures_and_no_outputs() {
    let f = Fixture::new().await;
    f.append(JournalEvent::NodeFailed {
        node: n("x"),
        error: "boom".into(),
    })
    .await;
    let got = f.results().await.unwrap();
    assert_eq!(got.as_of, None);
    assert_eq!(got.nodes.len(), 1, "{:?}", got.nodes);
    assert_eq!(got.nodes[0].state, NodeState::Failed);
    assert_eq!(got.nodes[0].error.as_deref(), Some("boom"));
}

/// The gateway's transient-retry shape (SP-OPS-1.3): each attempt with budget left appends a
/// `NodeFailed` carrying "transient failure, retrying (attempt k of N): …" and a `RunPaused` with
/// the SAME reason and a `resume_after`; the final attempt appends the bare terminal error.
async fn retried(f: &Fixture, node: &str, attempt: u32, of: u32) {
    let reason = format!("transient failure, retrying (attempt {attempt} of {of}): upstream blip");
    f.append(JournalEvent::NodeFailed {
        node: n(node),
        error: reason.clone(),
    })
    .await;
    f.append(JournalEvent::RunPaused {
        reason,
        resume_after: Some(chrono::Utc::now()),
    })
    .await;
}

#[tokio::test]
async fn a_node_that_exhausted_its_retries_reports_the_terminal_error_not_a_retry_notice() {
    let f = Fixture::new().await;
    retried(&f, "ask", 1, 3).await;
    retried(&f, "ask", 2, 3).await;
    f.append(JournalEvent::NodeFailed {
        node: n("ask"),
        error: "upstream blip (status 500)".into(),
    })
    .await;
    f.scheduler
        .record_terminal(f.run, RunStatus::Failed, Some("upstream blip (status 500)"))
        .await
        .unwrap();
    let got = f.results().await.unwrap();
    let ask = row(&got.nodes, "ask");
    assert_eq!(ask.state, NodeState::Failed);
    assert_eq!(ask.error.as_deref(), Some("upstream blip (status 500)"));
}

#[tokio::test]
async fn a_node_waiting_on_a_retry_is_retrying_not_failed() {
    let f = Fixture::new().await;
    retried(&f, "ask", 1, 3).await;
    f.scheduler
        .record_paused(
            f.run,
            Some(chrono::Utc::now()),
            "transient failure, retrying",
        )
        .await
        .unwrap();
    let got = f.results().await.unwrap();
    let ask = row(&got.nodes, "ask");
    // Through the wire name, which is what the API serves.
    assert_eq!(
        serde_json::to_value(ask.state).unwrap(),
        json!("retrying"),
        "{ask:?}"
    );
    assert!(
        ask.error
            .as_deref()
            .is_some_and(|e| e.contains("attempt 1 of 3")),
        "the pending retry's reason is still shown: {ask:?}"
    );
}

#[tokio::test]
async fn a_retry_pending_when_the_run_was_cancelled_is_a_failure() {
    let f = Fixture::new().await;
    retried(&f, "ask", 1, 3).await;
    f.scheduler.cancel(f.run).await.unwrap();
    let got = f.results().await.unwrap();
    assert_eq!(
        row(&got.nodes, "ask").state,
        NodeState::Failed,
        "nothing will retry a node of a terminal run"
    );
}

#[tokio::test]
async fn a_nested_node_that_failed_and_then_completed_is_not_reported_failed() {
    let f = Fixture::new().await;
    // The outer checkpoint lists only the subgraph node `sub`; its inner nodes are namespaced
    // (`sub/x`) and appear in the journal alone.
    retried(&f, "sub/x", 1, 3).await;
    f.append(JournalEvent::NodeCompleted { node: n("sub/x") })
        .await;
    let seq = f
        .append(JournalEvent::NodeCompleted { node: n("sub") })
        .await;
    f.journal
        .snapshot(
            f.run,
            Snapshot {
                seq,
                completed: vec![n("sub")],
                outputs: vec![(n("sub"), EffectOutput::Inline(json!("done")))],
                ..Snapshot::default()
            },
        )
        .await
        .unwrap();
    f.scheduler
        .record_terminal(f.run, RunStatus::Completed, None)
        .await
        .unwrap();
    let got = f.results().await.unwrap();
    assert!(
        got.nodes.iter().all(|r| r.state != NodeState::Failed),
        "{:?}",
        got.nodes
    );
}
