//! Torii's live run-event stream (AG-18, torii#53): the human-in-the-loop moments of a run
//! — a node starts waiting on a signal, a gate, an agent's question, a loop gate or a
//! confirm-before-run tool call; a decision is honoured; a question is escalated — as one
//! serializable [`RunEvent`] type, fed by the orchestrator's `OrchestratorHooks`.
//!
//! [`RunEventSink`] is the hooks implementation every heavy-tier drive wires. It lives here,
//! in the shared layer, because the CLI's drives (`worker serve`, `run submit`) and the API's
//! `GET …/events` SSE stream (torii#51 owns that endpoint) must report the same events in the
//! same shape.
//!
//! **Non-blocking by construction.** The executor awaits every hook inline while it holds the
//! run, so a hook that waits on its consumer stalls the drive. [`RunEventSink`] hands each
//! event to a BOUNDED channel with `try_send` and never awaits: a full channel (a slow or
//! stalled consumer) or a closed one (no consumer at all) DROPS the event, counts it
//! ([`RunEventSink::dropped`]) and logs. A hook is best-effort observability, never something
//! execution depends on (gateway `hooks.md`: anything execution depends on is a durable
//! effect).

use chrono::{DateTime, Utc};
use orchestrator_core::{
    EffectId, GateOption, GateOutcome, LoopGateOption, NodeId, OrchestratorHooks, RunId,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

/// How many undelivered events a drive may run ahead of its consumer before events drop.
pub const DEFAULT_EVENT_BUFFER: usize = 1024;

/// The receiving half of a [`RunEventSink`].
pub type RunEvents = mpsc::Receiver<RunEvent>;

/// One event of one run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunEvent {
    pub run: uuid::Uuid,
    #[serde(flatten)]
    pub kind: RunEventKind,
}

/// One option of a `HumanGate`'s menu, as the human is shown it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GateChoice {
    pub name: String,
    /// Choosing it fails the gate (`GateOutcome::Fail`) rather than completing it.
    pub fails: bool,
}

/// One option of a loop gate's menu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoopGateChoice {
    pub name: String,
    /// Choosing it converges the loop rather than running another iteration.
    pub stops: bool,
}

/// What happened. Every string has already been through the executor's redactor (gateway
/// `OrchestratorHooks`: hook arguments are redacted), so an event is safe to stream as-is.
/// `call` is the confirm-before-run call's effect id — what `torii run tool approve --call`
/// takes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunEventKind {
    SignalAwaited {
        node: String,
        deadline: Option<DateTime<Utc>>,
    },
    SignalReceived {
        node: String,
        payload: serde_json::Value,
    },
    GateAwaited {
        node: String,
        deadline: Option<DateTime<Utc>>,
        options: Vec<GateChoice>,
    },
    GateDecided {
        node: String,
        option: String,
        actor: String,
        note: Option<String>,
    },
    AgentAwaited {
        node: String,
        deadline: Option<DateTime<Utc>>,
        prompt: String,
    },
    AgentAnswered {
        node: String,
        text: String,
        actor: String,
    },
    AgentEscalated {
        node: String,
        from: String,
        to: String,
        deadline: Option<DateTime<Utc>>,
    },
    LoopGateAwaited {
        node: String,
        deadline: Option<DateTime<Utc>>,
        prompt: String,
        menu: Vec<LoopGateChoice>,
    },
    LoopGateDecided {
        node: String,
        option: String,
        actor: String,
    },
    LoopGateSettled {
        node: String,
        option: String,
    },
    ToolConfirmAwaited {
        node: String,
        call: String,
        tool: String,
        arguments: String,
        deadline: Option<DateTime<Utc>>,
    },
    ToolConfirmDecided {
        node: String,
        call: String,
        approved: bool,
        actor: String,
        note: Option<String>,
    },
}

/// The `OrchestratorHooks` that feed [`RunEvents`]. See the module docs: it never awaits its
/// consumer.
pub struct RunEventSink {
    tx: mpsc::Sender<RunEvent>,
    dropped: AtomicU64,
}

impl RunEventSink {
    /// A sink whose channel holds at most `capacity` undelivered events, and its receiver.
    pub fn bounded(capacity: usize) -> (Arc<Self>, RunEvents) {
        let (tx, rx) = mpsc::channel(capacity);
        (
            Arc::new(Self {
                tx,
                dropped: AtomicU64::new(0),
            }),
            rx,
        )
    }

    /// Events dropped so far because the channel was full or its receiver was gone.
    pub fn dropped(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

#[async_trait::async_trait]
impl OrchestratorHooks for RunEventSink {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn run() -> RunId {
        RunId(uuid::Uuid::from_u128(7))
    }

    fn node(s: &str) -> NodeId {
        NodeId(s.to_string())
    }

    fn at() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-07T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn drain(rx: &mut RunEvents) -> Vec<RunEvent> {
        let mut out = Vec::new();
        while let Ok(e) = rx.try_recv() {
            out.push(e);
        }
        out
    }

    /// Every one of the twelve HITL hooks becomes exactly one event, carrying every argument
    /// the hook was handed — nothing renamed into a different node, nothing lost.
    #[tokio::test]
    async fn each_hitl_hook_becomes_its_run_event() {
        let (sink, mut rx) = RunEventSink::bounded(64);
        let r = run();
        let gate_menu = [
            GateOption {
                name: "ship".into(),
                outcome: GateOutcome::Complete,
            },
            GateOption {
                name: "hold".into(),
                outcome: GateOutcome::Fail,
            },
        ];
        let loop_menu = [
            LoopGateOption {
                name: "again".into(),
                stops: false,
            },
            LoopGateOption {
                name: "done".into(),
                stops: true,
            },
        ];
        let call = EffectId("call-1".into());
        sink.on_signal_awaited(r, &node("s"), Some(at())).await;
        sink.on_signal_received(r, &node("s"), &serde_json::json!({"ok": true}))
            .await;
        sink.on_gate_awaited(r, &node("g"), None, &gate_menu).await;
        sink.on_gate_decided(r, &node("g"), "hold", "ana", Some("not yet"))
            .await;
        sink.on_agent_awaited(r, &node("a"), Some(at()), "which region?")
            .await;
        sink.on_agent_escalated(r, &node("a"), "triage", "lead", Some(at()))
            .await;
        sink.on_agent_answered(r, &node("a"), "eu-west", "bo").await;
        sink.on_loop_gate_awaited(r, &node("l/0/__gate__"), None, "again?", &loop_menu)
            .await;
        sink.on_loop_gate_decided(r, &node("l/0/__gate__"), "done", "cy")
            .await;
        sink.on_loop_gate_settled(r, &node("l/0/__gate__"), "done")
            .await;
        sink.on_tool_confirm_awaited(r, &node("t"), &call, "shell", "{\"cmd\":\"ls\"}", None)
            .await;
        sink.on_tool_confirm_decided(r, &node("t"), &call, false, "di", None)
            .await;

        let s = |v: &str| v.to_string();
        let expected = vec![
            RunEventKind::SignalAwaited {
                node: s("s"),
                deadline: Some(at()),
            },
            RunEventKind::SignalReceived {
                node: s("s"),
                payload: serde_json::json!({"ok": true}),
            },
            RunEventKind::GateAwaited {
                node: s("g"),
                deadline: None,
                options: vec![
                    GateChoice {
                        name: s("ship"),
                        fails: false,
                    },
                    GateChoice {
                        name: s("hold"),
                        fails: true,
                    },
                ],
            },
            RunEventKind::GateDecided {
                node: s("g"),
                option: s("hold"),
                actor: s("ana"),
                note: Some(s("not yet")),
            },
            RunEventKind::AgentAwaited {
                node: s("a"),
                deadline: Some(at()),
                prompt: s("which region?"),
            },
            RunEventKind::AgentEscalated {
                node: s("a"),
                from: s("triage"),
                to: s("lead"),
                deadline: Some(at()),
            },
            RunEventKind::AgentAnswered {
                node: s("a"),
                text: s("eu-west"),
                actor: s("bo"),
            },
            RunEventKind::LoopGateAwaited {
                node: s("l/0/__gate__"),
                deadline: None,
                prompt: s("again?"),
                menu: vec![
                    LoopGateChoice {
                        name: s("again"),
                        stops: false,
                    },
                    LoopGateChoice {
                        name: s("done"),
                        stops: true,
                    },
                ],
            },
            RunEventKind::LoopGateDecided {
                node: s("l/0/__gate__"),
                option: s("done"),
                actor: s("cy"),
            },
            RunEventKind::LoopGateSettled {
                node: s("l/0/__gate__"),
                option: s("done"),
            },
            RunEventKind::ToolConfirmAwaited {
                node: s("t"),
                call: s("call-1"),
                tool: s("shell"),
                arguments: s("{\"cmd\":\"ls\"}"),
                deadline: None,
            },
            RunEventKind::ToolConfirmDecided {
                node: s("t"),
                call: s("call-1"),
                approved: false,
                actor: s("di"),
                note: None,
            },
        ];
        let got = drain(&mut rx);
        assert!(
            got.iter().all(|e| e.run == r.0),
            "every event names its run: {got:?}"
        );
        assert_eq!(
            got.into_iter().map(|e| e.kind).collect::<Vec<_>>(),
            expected
        );
        assert_eq!(sink.dropped(), 0);
    }

    /// The wire shape an SSE consumer reads: the run beside a `type` tag and the fields.
    #[test]
    fn a_run_event_serializes_flat_with_a_type_tag() {
        let e = RunEvent {
            run: run().0,
            kind: RunEventKind::ToolConfirmDecided {
                node: "t".into(),
                call: "call-1".into(),
                approved: true,
                actor: "di".into(),
                note: None,
            },
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(
            v,
            serde_json::json!({
                "run": run().0.to_string(),
                "type": "tool_confirm_decided",
                "node": "t",
                "call": "call-1",
                "approved": true,
                "actor": "di",
                "note": null,
            })
        );
        assert_eq!(serde_json::from_value::<RunEvent>(v).unwrap(), e);
    }

    /// A consumer that never reads cannot stall the drive: the hook returns at once with the
    /// channel full, keeps the OLDEST events it could buffer, and counts every one it dropped.
    #[tokio::test]
    async fn a_full_channel_drops_and_counts_and_never_blocks() {
        let (sink, mut rx) = RunEventSink::bounded(2);
        tokio::time::timeout(Duration::from_secs(5), async {
            for i in 0..100 {
                sink.on_loop_gate_settled(run(), &node(&format!("n{i}")), "done")
                    .await;
            }
        })
        .await
        .expect("a full channel must never make a hook wait for its consumer");
        assert_eq!(sink.dropped(), 98, "every event past the buffer is counted");
        let kept: Vec<_> = drain(&mut rx)
            .into_iter()
            .map(|e| match e.kind {
                RunEventKind::LoopGateSettled { node, .. } => node,
                other => panic!("unexpected {other:?}"),
            })
            .collect();
        assert_eq!(kept, ["n0", "n1"]);
    }

    /// No consumer at all (the receiver is gone) is a drop too — never a panic, never a wait.
    #[tokio::test]
    async fn a_closed_channel_drops_and_counts() {
        let (sink, rx) = RunEventSink::bounded(4);
        drop(rx);
        sink.on_signal_awaited(run(), &node("s"), None).await;
        sink.on_agent_answered(run(), &node("a"), "x", "y").await;
        assert_eq!(sink.dropped(), 2);
    }
}
