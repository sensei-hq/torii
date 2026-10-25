//! AG-18 (torii#53): the run-event sink against a REAL drive. The executor awaits every hook
//! inline while it holds the run, so a consumer that never reads must cost the drive nothing:
//! it still reaches its durable pause, and the events past the buffer are dropped and counted.

use orchestrator::test_support::{FakeClock, recording_gateway};
use orchestrator::{Executor, Scheduler};
use orchestrator_core::{Graph, Node, NodeId, NodeKind, RunBudget, RunId};
use orchestrator_store::{InMemoryJournal, InMemorySchedulerStore};
use std::sync::Arc;
use std::time::Duration;
use torii_core::events::{RunEventKind, RunEventSink};

#[tokio::test]
async fn a_consumer_that_never_reads_cannot_stall_a_drive() {
    // Three independent waits: one drive asks all three before it pauses, so it fires three
    // awaited hooks into a buffer of one that nobody drains.
    let graph = Graph {
        nodes: ["a", "b", "c"]
            .into_iter()
            .map(|id| Node {
                id: NodeId(id.into()),
                kind: NodeKind::AwaitSignal { timeout: None },
                deps: vec![],
            })
            .collect(),
    };
    let (sink, mut events) = RunEventSink::bounded(1);
    let journal = Arc::new(InMemoryJournal::new());
    let (gw, _calls) = recording_gateway().await;
    let exec = Executor::new(Arc::new(gw), journal.clone(), "v1").with_hooks(sink.clone());
    let sched = Scheduler::new(
        Arc::new(InMemorySchedulerStore::default()),
        exec,
        journal,
        FakeClock::new(chrono::Utc::now()),
    );
    let run = RunId(uuid::Uuid::new_v4());

    let outcome = tokio::time::timeout(
        Duration::from_secs(10),
        sched.submit_with_budget(run, graph, RunBudget::default()),
    )
    .await
    .expect("an undrained event channel must not stall the drive")
    .expect("the drive succeeds");

    assert!(outcome.paused.is_some(), "the drive reached its pause");
    assert_eq!(
        sink.dropped(),
        2,
        "three asks into a buffer of one: two dropped, and counted"
    );
    let kept = events.try_recv().expect("the first ask was buffered");
    assert_eq!(kept.run, run.0);
    assert!(
        matches!(kept.kind, RunEventKind::SignalAwaited { .. }),
        "{kept:?}"
    );
}
