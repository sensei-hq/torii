//! The bounded agentic tool loop driver (D6).
//!
//! Engine-independent: the driver offers the model **only the resolved allowed tools**, and for
//! every tool call the model emits it runs the [`ToolInvoker`] (invoke-time allow-list re-check +
//! fail-closed redaction + audit) and feeds the redacted result — or a block notice, so the model
//! can recover — back for the next turn. The loop is hard-bounded by `max_iterations` so a model
//! that keeps calling tools can't run away. The gateway supplies a [`ModelTurn`] impl that meters
//! each turn (one `inference_calls` row + budget reserve→commit) and maps to/from the engine types.

use async_trait::async_trait;

use crate::error::ToolError;
use crate::invoker::{InvokeCtx, ToolInvoker};
use crate::types::{AllowedToolSet, ToolDef, ToolInvocation, ToolOutcome, ToolProvenance};

/// Loop bounds. `max_iterations` caps total model turns (D6 default 8).
#[derive(Debug, Clone)]
pub struct ToolLoopConfig {
    pub max_iterations: u8,
}

impl Default for ToolLoopConfig {
    fn default() -> Self {
        Self { max_iterations: 8 }
    }
}

/// A tool result fed back into the next model turn. The gateway maps this to an engine
/// `tool_result` message. `content` is already redacted (Invoked) or a safe block notice.
#[derive(Debug, Clone)]
pub struct ToolResultMessage {
    /// the engine tool-call id this result answers (paired back onto the `tool_result`).
    pub id: String,
    pub offered_name: String,
    pub content: String,
    pub is_error: bool,
}

/// The outcome of one model turn: a final answer, or tool calls to dispatch.
#[derive(Debug, Clone)]
pub enum TurnOutput {
    Answer(String),
    ToolCalls(Vec<ToolInvocation>),
}

/// One metered model turn. The gateway's impl reserves→commits budget, offers `tools` to the
/// engine, appends `results` as `tool_result` messages, and writes one `inference_calls` row.
#[async_trait]
pub trait ModelTurn: Send + Sync {
    async fn turn(
        &self,
        tools: &[ToolDef],
        results: &[ToolResultMessage],
    ) -> Result<TurnOutput, ToolError>;
}

/// The result of the whole loop.
#[derive(Debug, Clone)]
pub struct LoopResult {
    pub answer: String,
    /// one entry per tool invocation attempt (safe metadata) → `governance.tools[]`.
    pub provenance: Vec<ToolProvenance>,
    /// true if the loop hit `max_iterations` without the model producing a final answer.
    pub stopped_at_limit: bool,
}

/// Drive the bounded agentic loop. Only tools in `allowed` are ever offered; every call is
/// enforced by `invoker` (a forged call is blocked and fed back as an error, never executed).
pub async fn run_tool_loop(
    cfg: &ToolLoopConfig,
    ctx: &InvokeCtx,
    allowed: &AllowedToolSet,
    invoker: &ToolInvoker<'_>,
    model: &dyn ModelTurn,
) -> Result<LoopResult, ToolError> {
    // The results of the LAST round only — the ModelTurn impl accumulates full history itself,
    // so each turn is fed just the new tool results to append (not the cumulative list).
    let mut pending: Vec<ToolResultMessage> = Vec::new();
    let mut provenance: Vec<ToolProvenance> = Vec::new();

    for _ in 0..cfg.max_iterations.max(1) {
        match model.turn(&allowed.tools, &pending).await? {
            TurnOutput::Answer(answer) => {
                return Ok(LoopResult {
                    answer,
                    provenance,
                    stopped_at_limit: false,
                })
            }
            TurnOutput::ToolCalls(calls) if calls.is_empty() => {
                // no calls and no answer — nothing more to do; return what we have.
                return Ok(LoopResult {
                    answer: String::new(),
                    provenance,
                    stopped_at_limit: false,
                });
            }
            TurnOutput::ToolCalls(calls) => {
                let mut round: Vec<ToolResultMessage> = Vec::new();
                for call in calls {
                    // Enforce every call — a non-allowed one is blocked here, never executed.
                    let result = invoker.invoke(ctx, allowed, &call).await;
                    let is_error = result.outcome != ToolOutcome::Invoked;
                    let content = if is_error {
                        // Feed a safe block notice back so the model can recover (no raw detail).
                        match result.error.as_deref() {
                            Some(reason) => format!("tool call blocked: {reason}"),
                            None => "tool call blocked".to_string(),
                        }
                    } else {
                        result.output.clone().unwrap_or_default()
                    };
                    provenance.push(result.provenance());
                    round.push(ToolResultMessage {
                        id: call.id,
                        offered_name: call.offered_name,
                        content,
                        is_error,
                    });
                }
                pending = round;
            }
        }
    }

    // Hit the iteration cap without a final answer — return a bounded, non-runaway result.
    Ok(LoopResult {
        answer: String::new(),
        provenance,
        stopped_at_limit: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{DiscoveredTool, McpClient, RawToolOutput};
    use crate::invoker::{ToolAudit, ToolAuditSink, ToolRedactor, ToolTransport};
    use crate::types::{
        offered_name, Direction, RedactionSummary, ToolBinding, ToolDef, ToolKey, Transport,
    };
    use std::sync::Mutex;
    use uuid::Uuid;

    // ── minimal invoker collaborators (pass-through) ──
    struct EchoClient;
    #[async_trait]
    impl McpClient for EchoClient {
        async fn list_tools(&self) -> Result<Vec<DiscoveredTool>, ToolError> {
            Ok(vec![])
        }
        async fn call_tool(&self, _t: &str, args: &str) -> Result<RawToolOutput, ToolError> {
            Ok(RawToolOutput {
                text: format!("echo:{args}"),
                is_error: false,
            })
        }
    }
    struct EchoTransport;
    #[async_trait]
    impl ToolTransport for EchoTransport {
        async fn client_for(&self, _b: &ToolBinding) -> Result<Box<dyn McpClient>, ToolError> {
            Ok(Box::new(EchoClient))
        }
    }
    struct NoopRedactor;
    impl ToolRedactor for NoopRedactor {
        fn redact(
            &self,
            _d: Direction,
            t: &str,
        ) -> Result<(String, Vec<RedactionSummary>), ToolError> {
            Ok((t.to_string(), vec![]))
        }
    }
    #[derive(Default)]
    struct CountAudit(Mutex<usize>);
    #[async_trait]
    impl ToolAuditSink for CountAudit {
        async fn record(&self, _e: &ToolAudit) {
            *self.0.lock().unwrap() += 1;
        }
    }

    // ── scripted model ──
    struct ScriptedModel {
        script: Mutex<std::collections::VecDeque<TurnOutput>>,
        first_offer_len: Mutex<Option<usize>>,
    }
    impl ScriptedModel {
        fn new(turns: Vec<TurnOutput>) -> Self {
            Self {
                script: Mutex::new(turns.into()),
                first_offer_len: Mutex::new(None),
            }
        }
    }
    #[async_trait]
    impl ModelTurn for ScriptedModel {
        async fn turn(
            &self,
            tools: &[ToolDef],
            _results: &[ToolResultMessage],
        ) -> Result<TurnOutput, ToolError> {
            let mut first = self.first_offer_len.lock().unwrap();
            if first.is_none() {
                *first = Some(tools.len());
            }
            Ok(self
                .script
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(TurnOutput::Answer("done".into())))
        }
    }

    fn allowed_web_fetch() -> AllowedToolSet {
        AllowedToolSet::new(vec![ToolDef {
            offered_name: offered_name("web", "fetch"),
            description: None,
            input_schema: serde_json::json!({}),
            binding: ToolBinding {
                key: ToolKey {
                    server_id: Uuid::nil(),
                    tool_name: "fetch".into(),
                },
                server_name: "web".into(),
                transport: Transport::Http,
                plane: crate::types::Plane::Cloud,
            },
        }])
    }
    fn ctx() -> InvokeCtx {
        InvokeCtx {
            tenant_id: Uuid::nil(),
            actor_id: Uuid::nil(),
        }
    }
    fn call(name: &str) -> ToolInvocation {
        ToolInvocation {
            id: "call-1".into(),
            offered_name: name.into(),
            arguments: "{}".into(),
        }
    }

    async fn run(
        cfg: ToolLoopConfig,
        allowed: &AllowedToolSet,
        model: &ScriptedModel,
    ) -> (LoopResult, usize) {
        let transport = EchoTransport;
        let redactor = NoopRedactor;
        let audit = CountAudit::default();
        let invoker = ToolInvoker::new(&transport, &redactor, &audit);
        let r = run_tool_loop(&cfg, &ctx(), allowed, &invoker, model).await.unwrap();
        let n = *audit.0.lock().unwrap();
        (r, n)
    }

    #[tokio::test]
    async fn immediate_answer_makes_no_tool_calls() {
        let model = ScriptedModel::new(vec![TurnOutput::Answer("hi".into())]);
        let (r, audits) = run(ToolLoopConfig::default(), &allowed_web_fetch(), &model).await;
        assert_eq!(r.answer, "hi");
        assert!(r.provenance.is_empty());
        assert_eq!(audits, 0);
    }

    #[tokio::test]
    async fn a_tool_call_then_an_answer_invokes_once() {
        let model = ScriptedModel::new(vec![
            TurnOutput::ToolCalls(vec![call("web__fetch")]),
            TurnOutput::Answer("grounded".into()),
        ]);
        let (r, audits) = run(ToolLoopConfig::default(), &allowed_web_fetch(), &model).await;
        assert_eq!(r.answer, "grounded");
        assert_eq!(r.provenance.len(), 1);
        assert_eq!(r.provenance[0].outcome, ToolOutcome::Invoked);
        assert_eq!(audits, 1);
    }

    #[tokio::test]
    async fn a_forged_call_in_the_loop_is_blocked_and_fed_back() {
        let model = ScriptedModel::new(vec![
            TurnOutput::ToolCalls(vec![call("web__delete")]), // not in the allow-list
            TurnOutput::Answer("recovered".into()),
        ]);
        let (r, _audits) = run(ToolLoopConfig::default(), &allowed_web_fetch(), &model).await;
        assert_eq!(r.answer, "recovered"); // the model recovered after the block
        assert_eq!(r.provenance.len(), 1);
        assert_eq!(r.provenance[0].outcome, ToolOutcome::BlockedNotAllowed);
    }

    #[tokio::test]
    async fn only_allowed_tools_are_offered_to_the_model() {
        // an empty allow-list means zero tools offered (default-deny at the offer point).
        let model = ScriptedModel::new(vec![TurnOutput::Answer("no tools".into())]);
        let (_r, _) = run(ToolLoopConfig::default(), &AllowedToolSet::default(), &model).await;
        assert_eq!(*model.first_offer_len.lock().unwrap(), Some(0));
    }

    #[tokio::test]
    async fn a_model_that_keeps_calling_terminates_at_max_iterations() {
        // every turn emits a tool call → the loop must stop at the cap, not run away.
        let turns = (0..20)
            .map(|_| TurnOutput::ToolCalls(vec![call("web__fetch")]))
            .collect();
        let model = ScriptedModel::new(turns);
        let (r, _) = run(
            ToolLoopConfig { max_iterations: 4 },
            &allowed_web_fetch(),
            &model,
        )
        .await;
        assert!(r.stopped_at_limit);
        assert_eq!(r.provenance.len(), 4); // exactly max_iterations tool turns, no more
    }
}
