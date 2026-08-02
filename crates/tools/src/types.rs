use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Execution plane a tool runs on. `Local` = the desktop (in-process/sidecar), `Cloud` =
/// through the central gateway. `Unknown` until a trace resolves it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Plane {
    Local,
    Cloud,
    Unknown,
}

/// MCP transport. `stdio` spawns a subprocess and is **device-plane only** (D2) — the central
/// gateway never spawns one; `http`/`sse` are reachable centrally behind the SSRF filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Transport {
    Stdio,
    Http,
    Sse,
}

impl Transport {
    /// stdio subprocesses may only run on the device plane — refuse them centrally (D2).
    pub fn is_device_only(&self) -> bool {
        matches!(self, Transport::Stdio)
    }
}

/// The stable identity of a tool: which server it belongs to + the tool's own MCP name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ToolKey {
    pub server_id: Uuid,
    pub tool_name: String,
}

/// The namespaced function name a tool is offered to the model under (`{server}__{tool}`) —
/// so a returned tool call routes back to exactly one `(server, tool)` even when two servers
/// expose tools of the same MCP name.
pub fn offered_name(server_name: &str, tool_name: &str) -> String {
    format!("{server_name}__{tool_name}")
}

/// How a resolved tool is reached + which server/plane backs it. The invoke-time re-check
/// keys off the `AllowedToolSet` map of `offered_name -> ToolBinding`.
#[derive(Debug, Clone)]
pub struct ToolBinding {
    pub key: ToolKey,
    pub server_name: String,
    pub transport: Transport,
    pub plane: Plane,
}

/// A resolved, allowed tool ready to offer to the model.
#[derive(Debug, Clone)]
pub struct ToolDef {
    /// the namespaced function name the model sees and calls back.
    pub offered_name: String,
    pub description: Option<String>,
    /// the tool's JSON-Schema (from `mcp_server_tools.json_schema`), passed to the model verbatim.
    pub input_schema: serde_json::Value,
    pub binding: ToolBinding,
}

/// The default-deny result of resolution: the exact tools a caller may use in a space, plus a
/// fast `offered_name -> binding` map that is the **invoke-time enforcement primitive**. A name
/// absent from `by_name` is denied — there is no fallback path.
#[derive(Debug, Clone, Default)]
pub struct AllowedToolSet {
    pub tools: Vec<ToolDef>,
    pub by_name: HashMap<String, ToolBinding>,
}

impl AllowedToolSet {
    /// Build the set from resolved tool defs, indexing them by their offered name.
    pub fn new(tools: Vec<ToolDef>) -> Self {
        let by_name = tools
            .iter()
            .map(|t| (t.offered_name.clone(), t.binding.clone()))
            .collect();
        Self { tools, by_name }
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    /// The invoke-time enforcement primitive: the binding for an offered name, or `None`
    /// (denied). Default-deny — anything not explicitly resolved is absent here.
    pub fn binding_for(&self, offered_name: &str) -> Option<&ToolBinding> {
        self.by_name.get(offered_name)
    }
}

/// A tool call the model asked for (parsed from the engine's `ToolCall`). `arguments` is the
/// raw JSON-string argument object — it is **never serialized to a client** (redaction summary
/// only).
#[derive(Debug, Clone)]
pub struct ToolInvocation {
    /// the namespaced function name the model emitted.
    pub offered_name: String,
    pub arguments: String,
}

/// The outcome of an invocation attempt. Every `Blocked*` variant is terminal + audited and
/// guarantees the tool transport was **never reached** (except `Error`, a post-dispatch fault).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolOutcome {
    Invoked,
    BlockedNotAllowed,
    BlockedSsrf,
    BlockedRedactionFailClosed,
    BlockedDeviceOnly,
    Error,
}

/// Direction of a redaction pass around an invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Input,
    Output,
}

/// A privacy-safe summary of a redaction pass — the *type* + *count* of hits, never the value
/// or its offsets. This is the only redaction detail that ever leaves the runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RedactionSummary {
    pub direction: Direction,
    pub r#type: String,
    pub count: u32,
}

/// The full internal result of an invocation. Deliberately **not** `Serialize`: the raw
/// `output` (which is fed back to the model) must never reach a client. Expose
/// [`ToolResult::provenance`] instead.
#[derive(Debug, Clone)]
pub struct ToolResult {
    pub server_name: String,
    pub tool_name: String,
    pub outcome: ToolOutcome,
    /// the redacted tool output to feed back to the model; `None` on a block.
    pub output: Option<String>,
    pub redactions: Vec<RedactionSummary>,
    pub plane: Plane,
    pub latency_ms: u64,
    /// operator-facing block/error detail (e.g. the SSRF reason); never raw args/output.
    pub error: Option<String>,
}

impl ToolResult {
    /// The client-facing provenance row for `governance.tools[]` — only safe metadata (server,
    /// tool, outcome, redaction type+count, plane, latency). No raw arguments or output.
    pub fn provenance(&self) -> ToolProvenance {
        ToolProvenance {
            server: self.server_name.clone(),
            tool: self.tool_name.clone(),
            outcome: self.outcome.clone(),
            redactions: self.redactions.clone(),
            plane: self.plane,
            latency_ms: self.latency_ms,
        }
    }
}

/// Client-facing tool provenance (`governance.tools[]`). The only tool-invocation shape that
/// is ever serialized outward — it carries no raw arguments/output/secrets by construction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolProvenance {
    pub server: String,
    pub tool: String,
    pub outcome: ToolOutcome,
    pub redactions: Vec<RedactionSummary>,
    pub plane: Plane,
    pub latency_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provenance_exposes_only_safe_metadata_never_raw_output() {
        let r = ToolResult {
            server_name: "filesystem".into(),
            tool_name: "read_file".into(),
            outcome: ToolOutcome::Invoked,
            output: Some("contents with a secret sk-live-SHOULD-NOT-LEAK".into()),
            redactions: vec![RedactionSummary {
                direction: Direction::Output,
                r#type: "SECRET".into(),
                count: 1,
            }],
            plane: Plane::Cloud,
            latency_ms: 12,
            error: None,
        };
        let json = serde_json::to_string(&r.provenance()).unwrap();
        assert!(json.contains("read_file"));
        assert!(json.contains("SECRET"));
        // the redaction summary's direction is the ONLY legitimate "output" occurrence.
        assert!(json.contains(r#""direction":"output""#));
        // the raw tool output (the actual secret bytes) must never reach the client provenance.
        assert!(!json.contains("sk-live-SHOULD-NOT-LEAK"));
        assert!(!json.contains("contents with a secret"));
    }

    #[test]
    fn stdio_is_device_only() {
        assert!(Transport::Stdio.is_device_only());
        assert!(!Transport::Http.is_device_only());
        assert!(!Transport::Sse.is_device_only());
    }

    #[test]
    fn allowed_set_is_default_deny_by_name() {
        let key = ToolKey {
            server_id: Uuid::nil(),
            tool_name: "read_file".into(),
        };
        let def = ToolDef {
            offered_name: offered_name("filesystem", "read_file"),
            description: None,
            input_schema: serde_json::json!({ "type": "object" }),
            binding: ToolBinding {
                key,
                server_name: "filesystem".into(),
                transport: Transport::Http,
                plane: Plane::Cloud,
            },
        };
        let set = AllowedToolSet::new(vec![def]);
        assert_eq!(set.len(), 1);
        assert!(set.binding_for("filesystem__read_file").is_some());
        // anything not explicitly resolved is denied (no fallback).
        assert!(set.binding_for("filesystem__write_file").is_none());
        assert!(set.binding_for("read_file").is_none());
    }

    #[test]
    fn offered_name_namespaces_by_server() {
        assert_eq!(offered_name("fs", "read"), "fs__read");
    }
}
