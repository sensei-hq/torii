//! `ToolInvoker` — server-side enforcement at tool-call time.
//!
//! The single choke point every tool call passes through, on both planes. In order:
//! 1. **Invoke-time allow-list re-check** — `allowed.binding_for(name)` or `BlockedNotAllowed`.
//!    A forged/hallucinated call for a name not in the resolved set never reaches a transport.
//! 2. **Fail-closed W5 redaction of the input** — a redactor fault ⇒ `BlockedRedactionFailClosed`
//!    (the raw arguments never egress).
//! 3. **Transport acquisition** — the host wires SSRF filtering (`http`/`sse`) and the
//!    device-only rule (`stdio`) here; a rejection maps to `BlockedSsrf` / `BlockedDeviceOnly`.
//! 4. **`tools/call`** with the *redacted* arguments.
//! 5. **Fail-closed W5 redaction of the output** before it re-enters the model.
//! 6. **Exactly one audit record** per invocation — tool name + outcome + redaction type/counts,
//!    never raw arguments/output or a decrypted credential.
//!
//! Redaction, transport, and audit are injected traits so this logic is host-agnostic (central
//! + desktop) and fully unit-testable without a network, a DB, or the engine.

use std::time::Instant;

use async_trait::async_trait;
use uuid::Uuid;

use crate::client::McpClient;
use crate::error::ToolError;
use crate::types::{
    AllowedToolSet, Direction, Plane, RedactionSummary, ToolBinding, ToolInvocation, ToolOutcome,
    ToolResult,
};

/// Fail-closed W5 redaction of tool I/O. An `Err` means the detector could not complete — the
/// caller MUST NOT pass the raw text through (fail-closed).
pub trait ToolRedactor: Send + Sync {
    fn redact(
        &self,
        direction: Direction,
        text: &str,
    ) -> Result<(String, Vec<RedactionSummary>), ToolError>;
}

/// Resolves an [`McpClient`] for a tool's server. The host wires transport-specific security
/// here: `http`/`sse` clients are built behind the SSRF [`crate::egress::EgressFilter`] and with
/// the F3 credential decrypted at this moment; a `stdio` binding on the central plane returns
/// [`ToolError::DeviceOnly`].
#[async_trait]
pub trait ToolTransport: Send + Sync {
    async fn client_for(&self, binding: &ToolBinding) -> Result<Box<dyn McpClient>, ToolError>;
}

/// One audit record for a tool invocation attempt — safe metadata only.
#[derive(Debug, Clone)]
pub struct ToolAudit {
    pub tenant_id: Uuid,
    pub actor_id: Uuid,
    pub server: String,
    pub tool: String,
    pub outcome: ToolOutcome,
    pub redactions: Vec<RedactionSummary>,
    pub plane: Plane,
    pub latency_ms: u64,
    /// operator-facing block/error reason; never raw args/output or secrets.
    pub reason: Option<String>,
}

/// Sink for the audit + quality signal a tool invocation emits (the host writes to
/// `audit_events` + `quality_signals`).
#[async_trait]
pub trait ToolAuditSink: Send + Sync {
    async fn record(&self, entry: &ToolAudit);
}

/// The caller identity for an invocation (from the gateway RequestContext).
#[derive(Debug, Clone)]
pub struct InvokeCtx {
    pub tenant_id: Uuid,
    pub actor_id: Uuid,
}

/// Enforces the allow-list + fail-closed redaction around every MCP tool call.
pub struct ToolInvoker<'a> {
    transport: &'a dyn ToolTransport,
    redactor: &'a dyn ToolRedactor,
    audit: &'a dyn ToolAuditSink,
}

impl<'a> ToolInvoker<'a> {
    pub fn new(
        transport: &'a dyn ToolTransport,
        redactor: &'a dyn ToolRedactor,
        audit: &'a dyn ToolAuditSink,
    ) -> Self {
        Self {
            transport,
            redactor,
            audit,
        }
    }

    /// Invoke one tool the model asked for, enforcing the allow-list + redaction. Always
    /// returns a `ToolResult` (never panics); every path emits exactly one audit record.
    pub async fn invoke(
        &self,
        ctx: &InvokeCtx,
        allowed: &AllowedToolSet,
        inv: &ToolInvocation,
    ) -> ToolResult {
        let start = Instant::now();

        // 1. Invoke-time enforcement re-check — default-deny. A name not in the resolved set is
        //    blocked here, before any redaction/transport work.
        let Some(binding) = allowed.binding_for(&inv.offered_name).cloned() else {
            return self
                .blocked(
                    ctx,
                    "unknown",
                    &inv.offered_name,
                    Plane::Unknown,
                    ToolOutcome::BlockedNotAllowed,
                    Vec::new(),
                    Some("tool not in the caller's allow-list".into()),
                    start,
                )
                .await;
        };

        // 2. Fail-closed redaction of the tool INPUT before it egresses to the tool.
        let (clean_args, mut redactions) = match self.redactor.redact(Direction::Input, &inv.arguments)
        {
            Ok(v) => v,
            Err(e) => {
                return self
                    .blocked(
                        ctx,
                        &binding.server_name,
                        &binding.key.tool_name,
                        binding.plane,
                        ToolOutcome::BlockedRedactionFailClosed,
                        Vec::new(),
                        Some(format!("input redaction failed: {e}")),
                        start,
                    )
                    .await;
            }
        };

        // 3. Acquire the transport — SSRF (http/sse) + device-only (stdio) are enforced inside.
        let client = match self.transport.client_for(&binding).await {
            Ok(c) => c,
            Err(e) => {
                let (outcome, reason) = classify_transport_error(&e);
                return self
                    .blocked(
                        ctx,
                        &binding.server_name,
                        &binding.key.tool_name,
                        binding.plane,
                        outcome,
                        redactions,
                        Some(reason),
                        start,
                    )
                    .await;
            }
        };

        // 4. Call the tool with the REDACTED arguments.
        let raw = match client.call_tool(&binding.key.tool_name, &clean_args).await {
            Ok(r) => r,
            Err(e) => {
                let (outcome, reason) = classify_transport_error(&e);
                return self
                    .blocked(
                        ctx,
                        &binding.server_name,
                        &binding.key.tool_name,
                        binding.plane,
                        outcome,
                        redactions,
                        Some(reason),
                        start,
                    )
                    .await;
            }
        };

        // 5. Fail-closed redaction of the tool OUTPUT before it re-enters the model.
        let clean_out = match self.redactor.redact(Direction::Output, &raw.text) {
            Ok((clean, out_red)) => {
                redactions.extend(out_red);
                clean
            }
            Err(e) => {
                return self
                    .blocked(
                        ctx,
                        &binding.server_name,
                        &binding.key.tool_name,
                        binding.plane,
                        ToolOutcome::BlockedRedactionFailClosed,
                        redactions,
                        Some(format!("output redaction failed: {e}")),
                        start,
                    )
                    .await;
            }
        };

        let result = ToolResult {
            server_name: binding.server_name,
            tool_name: binding.key.tool_name,
            outcome: ToolOutcome::Invoked,
            output: Some(clean_out),
            redactions,
            plane: binding.plane,
            latency_ms: start.elapsed().as_millis() as u64,
            error: raw.is_error.then(|| "tool reported an error result".into()),
        };
        self.audit.record(&audit_of(ctx, &result)).await;
        result
    }

    /// Build + audit a blocked/failed result (transport was not reached, or output withheld).
    #[allow(clippy::too_many_arguments)]
    async fn blocked(
        &self,
        ctx: &InvokeCtx,
        server: &str,
        tool: &str,
        plane: Plane,
        outcome: ToolOutcome,
        redactions: Vec<RedactionSummary>,
        reason: Option<String>,
        start: Instant,
    ) -> ToolResult {
        let result = ToolResult {
            server_name: server.to_string(),
            tool_name: tool.to_string(),
            outcome,
            output: None,
            redactions,
            plane,
            latency_ms: start.elapsed().as_millis() as u64,
            error: reason,
        };
        self.audit.record(&audit_of(ctx, &result)).await;
        result
    }
}

/// Map a transport failure to a tool outcome + a safe reason string.
fn classify_transport_error(e: &ToolError) -> (ToolOutcome, String) {
    match e {
        ToolError::Ssrf(m) => (ToolOutcome::BlockedSsrf, format!("ssrf blocked: {m}")),
        ToolError::DeviceOnly => (
            ToolOutcome::BlockedDeviceOnly,
            "stdio tools run on the device only".into(),
        ),
        other => (ToolOutcome::Error, other.to_string()),
    }
}

/// Project a `ToolResult` into its audit record (safe metadata only).
fn audit_of(ctx: &InvokeCtx, r: &ToolResult) -> ToolAudit {
    ToolAudit {
        tenant_id: ctx.tenant_id,
        actor_id: ctx.actor_id,
        server: r.server_name.clone(),
        tool: r.tool_name.clone(),
        outcome: r.outcome.clone(),
        redactions: r.redactions.clone(),
        plane: r.plane,
        latency_ms: r.latency_ms,
        reason: r.error.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{DiscoveredTool, RawToolOutput};
    use crate::types::{offered_name, ToolBinding, ToolDef, ToolKey, Transport};
    use std::sync::Mutex;

    // ── mocks ──
    #[derive(Default)]
    struct Recorder {
        calls: Mutex<Vec<(String, String)>>, // (tool_name, arguments) as actually sent
    }

    struct MockClient {
        rec: std::sync::Arc<Recorder>,
        output: String,
        is_error: bool,
    }
    #[async_trait]
    impl McpClient for MockClient {
        async fn list_tools(&self) -> Result<Vec<DiscoveredTool>, ToolError> {
            Ok(vec![])
        }
        async fn call_tool(
            &self,
            tool_name: &str,
            arguments: &str,
        ) -> Result<RawToolOutput, ToolError> {
            self.rec
                .calls
                .lock()
                .unwrap()
                .push((tool_name.to_string(), arguments.to_string()));
            Ok(RawToolOutput {
                text: self.output.clone(),
                is_error: self.is_error,
            })
        }
    }

    struct MockTransport {
        rec: std::sync::Arc<Recorder>,
        output: String,
        error: Option<ToolError>,
    }
    #[async_trait]
    impl ToolTransport for MockTransport {
        async fn client_for(&self, _b: &ToolBinding) -> Result<Box<dyn McpClient>, ToolError> {
            if let Some(e) = &self.error {
                return Err(clone_err(e));
            }
            Ok(Box::new(MockClient {
                rec: self.rec.clone(),
                output: self.output.clone(),
                is_error: false,
            }))
        }
    }
    fn clone_err(e: &ToolError) -> ToolError {
        match e {
            ToolError::Ssrf(m) => ToolError::Ssrf(m.clone()),
            ToolError::DeviceOnly => ToolError::DeviceOnly,
            ToolError::Transport(m) => ToolError::Transport(m.clone()),
            ToolError::Config(m) => ToolError::Config(m.clone()),
            ToolError::RedactionFailClosed(m) => ToolError::RedactionFailClosed(m.clone()),
            #[cfg(feature = "db")]
            ToolError::Db(m) => ToolError::Db(m.clone()),
        }
    }

    /// Redacts any `sk-live-*` token to `[REDACTED]`; optionally fails-closed on one direction.
    struct MockRedactor {
        fail_on: Option<Direction>,
    }
    impl ToolRedactor for MockRedactor {
        fn redact(
            &self,
            direction: Direction,
            text: &str,
        ) -> Result<(String, Vec<RedactionSummary>), ToolError> {
            if self.fail_on == Some(direction) {
                return Err(ToolError::RedactionFailClosed("detector fault".into()));
            }
            if text.contains("sk-live") {
                Ok((
                    text.replace("sk-live-SECRET", "[REDACTED]"),
                    vec![RedactionSummary {
                        direction,
                        r#type: "SECRET".into(),
                        count: 1,
                    }],
                ))
            } else {
                Ok((text.to_string(), vec![]))
            }
        }
    }

    #[derive(Default)]
    struct MockAudit {
        rows: Mutex<Vec<ToolAudit>>,
    }
    #[async_trait]
    impl ToolAuditSink for MockAudit {
        async fn record(&self, entry: &ToolAudit) {
            self.rows.lock().unwrap().push(entry.clone());
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
                plane: Plane::Cloud,
            },
        }])
    }
    fn ctx() -> InvokeCtx {
        InvokeCtx {
            tenant_id: Uuid::nil(),
            actor_id: Uuid::nil(),
        }
    }

    #[tokio::test]
    async fn forged_call_is_blocked_and_never_reaches_the_transport() {
        let rec = std::sync::Arc::new(Recorder::default());
        let transport = MockTransport {
            rec: rec.clone(),
            output: "ok".into(),
            error: None,
        };
        let audit = MockAudit::default();
        let inv = ToolInvoker::new(&transport, &MockRedactor { fail_on: None }, &audit);
        // the model forges a call for a tool that isn't in the allow-list.
        let out = inv
            .invoke(
                &ctx(),
                &allowed_web_fetch(),
                &ToolInvocation {
                    offered_name: "web__delete".into(),
                    arguments: "{}".into(),
                },
            )
            .await;
        assert_eq!(out.outcome, ToolOutcome::BlockedNotAllowed);
        assert!(out.output.is_none());
        assert!(rec.calls.lock().unwrap().is_empty(), "transport must not be reached");
        assert_eq!(audit.rows.lock().unwrap().len(), 1, "exactly one audit row");
    }

    #[tokio::test]
    async fn input_and_output_are_redacted_around_the_call() {
        let rec = std::sync::Arc::new(Recorder::default());
        let transport = MockTransport {
            rec: rec.clone(),
            output: "here is sk-live-SECRET in the result".into(),
            error: None,
        };
        let audit = MockAudit::default();
        let inv = ToolInvoker::new(&transport, &MockRedactor { fail_on: None }, &audit);
        let out = inv
            .invoke(
                &ctx(),
                &allowed_web_fetch(),
                &ToolInvocation {
                    offered_name: "web__fetch".into(),
                    arguments: "{\"key\":\"sk-live-SECRET\"}".into(),
                },
            )
            .await;
        assert_eq!(out.outcome, ToolOutcome::Invoked);
        // the transport received the REDACTED arguments, never the raw secret.
        let sent = &rec.calls.lock().unwrap()[0].1;
        assert!(!sent.contains("sk-live-SECRET"));
        assert!(sent.contains("[REDACTED]"));
        // the output returned to the model is redacted too.
        assert!(!out.output.as_ref().unwrap().contains("sk-live-SECRET"));
        // both directions are reported in the redaction summary.
        assert!(out.redactions.iter().any(|r| r.direction == Direction::Input));
        assert!(out.redactions.iter().any(|r| r.direction == Direction::Output));
    }

    #[tokio::test]
    async fn input_redaction_fault_fails_closed_before_the_transport() {
        let rec = std::sync::Arc::new(Recorder::default());
        let transport = MockTransport {
            rec: rec.clone(),
            output: "ok".into(),
            error: None,
        };
        let audit = MockAudit::default();
        let inv = ToolInvoker::new(
            &transport,
            &MockRedactor {
                fail_on: Some(Direction::Input),
            },
            &audit,
        );
        let out = inv
            .invoke(
                &ctx(),
                &allowed_web_fetch(),
                &ToolInvocation {
                    offered_name: "web__fetch".into(),
                    arguments: "{\"key\":\"sk-live-SECRET\"}".into(),
                },
            )
            .await;
        assert_eq!(out.outcome, ToolOutcome::BlockedRedactionFailClosed);
        assert!(rec.calls.lock().unwrap().is_empty(), "raw input must never egress");
    }

    #[tokio::test]
    async fn output_redaction_fault_withholds_the_output() {
        let rec = std::sync::Arc::new(Recorder::default());
        let transport = MockTransport {
            rec: rec.clone(),
            output: "sk-live-SECRET".into(),
            error: None,
        };
        let audit = MockAudit::default();
        let inv = ToolInvoker::new(
            &transport,
            &MockRedactor {
                fail_on: Some(Direction::Output),
            },
            &audit,
        );
        let out = inv
            .invoke(
                &ctx(),
                &allowed_web_fetch(),
                &ToolInvocation {
                    offered_name: "web__fetch".into(),
                    arguments: "{}".into(),
                },
            )
            .await;
        assert_eq!(out.outcome, ToolOutcome::BlockedRedactionFailClosed);
        assert!(out.output.is_none(), "un-redactable output is withheld from the model");
    }

    #[tokio::test]
    async fn ssrf_rejection_maps_to_blocked_ssrf() {
        let rec = std::sync::Arc::new(Recorder::default());
        let transport = MockTransport {
            rec: rec.clone(),
            output: "ok".into(),
            error: Some(ToolError::Ssrf("resolves to 169.254.169.254".into())),
        };
        let audit = MockAudit::default();
        let inv = ToolInvoker::new(&transport, &MockRedactor { fail_on: None }, &audit);
        let out = inv
            .invoke(
                &ctx(),
                &allowed_web_fetch(),
                &ToolInvocation {
                    offered_name: "web__fetch".into(),
                    arguments: "{}".into(),
                },
            )
            .await;
        assert_eq!(out.outcome, ToolOutcome::BlockedSsrf);
        assert!(rec.calls.lock().unwrap().is_empty());
        assert_eq!(audit.rows.lock().unwrap().len(), 1);
    }
}
