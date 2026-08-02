//! X1 (P11) · Task 10 acceptance harness — the roadmap's three-part gate, verified against a
//! **real** HTTP MCP server with the **real** `HttpClient` transport + `ToolInvoker`:
//!
//!   (a) a tool NOT in the caller's allow-list is absent at resolve time and **blocked if forged**
//!       (the transport is never reached);
//!   (b) an `http` tool whose URL resolves to a private/loopback IP is **SSRF-blocked** before a
//!       socket opens;
//!   (c) tool inputs AND outputs **pass W5 redaction** before egress / before re-entering the model.
//!
//! No gateway/JWT/Ollama needed — the runtime is the unit under test. A tiny axum server plays the
//! MCP endpoint and records exactly what arguments it received, so we can prove the tool never sees
//! a raw secret.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use serde_json::{json, Value};
use uuid::Uuid;

use tools::{
    offered_name, AllowedToolSet, Direction, EgressFilter, EgressPolicy, HttpClient, InvokeCtx,
    McpClient, Plane, RedactionSummary, StdResolver, ToolAudit, ToolAuditSink, ToolBinding,
    ToolDef, ToolInvocation, ToolInvoker, ToolKey, ToolOutcome, ToolRedactor, ToolTransport,
    Transport,
};

// ── a real HTTP MCP demo server ────────────────────────────────────────────────────────────────
/// Spawn a minimal MCP server on an ephemeral localhost port. `received` records each
/// `tools/call` argument payload (so a test can assert the server never saw a raw secret). Its
/// `echo` tool returns the received args PLUS a secret of its own (to exercise output redaction).
async fn spawn_demo_server(received: Arc<Mutex<Vec<String>>>) -> String {
    use axum::{routing::post, Json, Router};

    let handler = move |Json(body): Json<Value>| {
        let received = received.clone();
        async move {
            let method = body["method"].as_str().unwrap_or("");
            let resp = match method {
                "tools/list" => json!({
                    "jsonrpc": "2.0", "id": 1,
                    "result": { "tools": [
                        { "name": "echo", "description": "echoes its input",
                          "inputSchema": { "type": "object" } }
                    ]}
                }),
                "tools/call" => {
                    let args = body["params"]["arguments"].to_string();
                    received.lock().unwrap().push(args.clone());
                    json!({
                        "jsonrpc": "2.0", "id": 1,
                        "result": {
                            "content": [ { "type": "text",
                                "text": format!("received {args}; here is sk-live-DEMO-OUTPUT-SECRET") } ],
                            "isError": false
                        }
                    })
                }
                _ => json!({ "jsonrpc": "2.0", "id": 1,
                             "error": { "code": -32601, "message": "method not found" } }),
            };
            Json(resp)
        }
    };
    let app = Router::new().route("/mcp", post(handler));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://127.0.0.1:{}/mcp", addr.port())
}

// ── real invoker collaborators ──
/// Builds a real `HttpClient` to the demo server (allow_insecure = localhost dev); refuses stdio.
struct DemoTransport {
    url: String,
}
#[async_trait]
impl ToolTransport for DemoTransport {
    async fn client_for(&self, b: &ToolBinding) -> Result<Box<dyn McpClient>, tools::ToolError> {
        if b.transport == Transport::Stdio {
            return Err(tools::ToolError::DeviceOnly);
        }
        let filter = EgressFilter::new(
            StdResolver,
            EgressPolicy {
                allow_insecure: true, // localhost demo server
                ..Default::default()
            },
        );
        Ok(Box::new(HttpClient::connect(
            &filter,
            &self.url,
            None,
            Duration::from_secs(5),
        )?))
    }
}

/// Strips `sk-live-*` secrets (a stand-in for the gateway's C4 redactor).
struct SecretRedactor;
impl ToolRedactor for SecretRedactor {
    fn redact(
        &self,
        direction: Direction,
        text: &str,
    ) -> Result<(String, Vec<RedactionSummary>), tools::ToolError> {
        let re = Regex::new(r"sk-live-[A-Za-z0-9-]+").unwrap();
        let count = re.find_iter(text).count() as u32;
        let clean = re.replace_all(text, "[REDACTED]").into_owned();
        let summaries = if count > 0 {
            vec![RedactionSummary {
                direction,
                r#type: "provider_key".into(),
                count,
            }]
        } else {
            vec![]
        };
        Ok((clean, summaries))
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

fn echo_allowed(server_id: Uuid) -> AllowedToolSet {
    AllowedToolSet::new(vec![ToolDef {
        offered_name: offered_name("demo", "echo"),
        description: None,
        input_schema: json!({}),
        binding: ToolBinding {
            key: ToolKey {
                server_id,
                tool_name: "echo".into(),
            },
            server_name: "demo".into(),
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

// ── (a) default-deny / forged-call ──
#[tokio::test]
async fn gate_a_forged_tool_is_blocked_and_the_server_is_never_reached() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let url = spawn_demo_server(received.clone()).await;
    let transport = DemoTransport { url };
    let audit = CountAudit::default();
    let invoker = ToolInvoker::new(&transport, &SecretRedactor, &audit);
    let allowed = echo_allowed(Uuid::new_v4());

    // a forged call for a tool that isn't allowed → blocked, demo server untouched.
    let forged = invoker
        .invoke(
            &ctx(),
            &allowed,
            &ToolInvocation {
                id: "1".into(),
                offered_name: "demo__delete".into(),
                arguments: "{}".into(),
            },
        )
        .await;
    assert_eq!(forged.outcome, ToolOutcome::BlockedNotAllowed);
    assert!(received.lock().unwrap().is_empty(), "server must not be reached");

    // the allowed tool DOES run through the real transport.
    let ok = invoker
        .invoke(
            &ctx(),
            &allowed,
            &ToolInvocation {
                id: "2".into(),
                offered_name: "demo__echo".into(),
                arguments: "{\"q\":\"hi\"}".into(),
            },
        )
        .await;
    assert_eq!(ok.outcome, ToolOutcome::Invoked);
    assert_eq!(received.lock().unwrap().len(), 1, "allowed tool reached the server once");
}

// ── (b) SSRF ──
#[tokio::test]
async fn gate_b_private_ip_tool_is_ssrf_blocked_before_any_socket() {
    // a binding whose server URL resolves to a private IP → the transport refuses to connect.
    struct PrivateTransport;
    #[async_trait]
    impl ToolTransport for PrivateTransport {
        async fn client_for(
            &self,
            _b: &ToolBinding,
        ) -> Result<Box<dyn McpClient>, tools::ToolError> {
            let filter = EgressFilter::new(StdResolver, EgressPolicy::default()); // prod policy
            Ok(Box::new(HttpClient::connect(
                &filter,
                "https://10.0.0.1/mcp",
                None,
                Duration::from_secs(5),
            )?))
        }
    }
    let audit = CountAudit::default();
    let invoker = ToolInvoker::new(&PrivateTransport, &SecretRedactor, &audit);
    let out = invoker
        .invoke(
            &ctx(),
            &echo_allowed(Uuid::new_v4()),
            &ToolInvocation {
                id: "1".into(),
                offered_name: "demo__echo".into(),
                arguments: "{}".into(),
            },
        )
        .await;
    assert_eq!(out.outcome, ToolOutcome::BlockedSsrf);
}

// ── (c) fail-forward W5 redaction on input AND output ──
#[tokio::test]
async fn gate_c_tool_io_is_redacted_before_egress_and_before_reentry() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let url = spawn_demo_server(received.clone()).await;
    let transport = DemoTransport { url };
    let audit = CountAudit::default();
    let invoker = ToolInvoker::new(&transport, &SecretRedactor, &audit);

    let out = invoker
        .invoke(
            &ctx(),
            &echo_allowed(Uuid::new_v4()),
            &ToolInvocation {
                id: "1".into(),
                offered_name: "demo__echo".into(),
                arguments: "{\"key\":\"sk-live-INPUT-SECRET\"}".into(),
            },
        )
        .await;
    assert_eq!(out.outcome, ToolOutcome::Invoked);

    // input redaction: the demo server never saw the raw input secret.
    let seen = received.lock().unwrap()[0].clone();
    assert!(!seen.contains("sk-live-INPUT-SECRET"), "raw input reached the tool: {seen}");
    assert!(seen.contains("[REDACTED]"));

    // output redaction: the demo server's own secret is stripped before it re-enters the model.
    let answer = out.output.unwrap();
    assert!(!answer.contains("sk-live-DEMO-OUTPUT-SECRET"), "raw tool output leaked: {answer}");

    // both directions are reported in the provenance summary.
    assert!(out.redactions.iter().any(|r| r.direction == Direction::Input));
    assert!(out.redactions.iter().any(|r| r.direction == Direction::Output));
}
