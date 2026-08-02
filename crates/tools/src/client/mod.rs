//! MCP transport clients.
//!
//! The [`McpClient`] trait is the only surface the invoker + discovery depend on, so the
//! enforcement/redaction logic is transport-agnostic and fully mockable in tests. Concrete
//! implementations: `HttpClient`/`SseClient` (central plane, every request pinned through
//! [`crate::egress::EgressFilter`]) and `StdioClient` (device plane only — constructing one
//! centrally is refused). The concrete transports are wired where they are first exercised
//! (discovery + the agentic loop); this module fixes the contract they satisfy.

use async_trait::async_trait;

use crate::error::ToolError;

/// A tool as returned by an MCP server's `tools/list` (before allow-list resolution). Cached
/// into `mcp_server_tools` by discovery.
#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveredTool {
    pub name: String,
    pub description: Option<String>,
    /// the tool's JSON-Schema for its argument object (stored verbatim, offered to the model).
    pub input_schema: serde_json::Value,
}

/// The raw result of an MCP `tools/call`, before W5 redaction. `is_error` distinguishes a
/// tool-level error result (fed back to the model) from a transport failure (a `ToolError`).
#[derive(Debug, Clone, PartialEq)]
pub struct RawToolOutput {
    pub text: String,
    pub is_error: bool,
}

/// An MCP transport client (`tools/list` + `tools/call`). v1 scope is tools only (no
/// resources/prompts — D9).
#[async_trait]
pub trait McpClient: Send + Sync {
    /// Discover the server's tools. Feeds the `mcp_server_tools` discovery cache.
    async fn list_tools(&self) -> Result<Vec<DiscoveredTool>, ToolError>;

    /// Invoke one tool with a JSON-string argument object. The returned text is raw
    /// (un-redacted) — the [`crate::invoker::ToolInvoker`] applies fail-closed W5 redaction
    /// before it re-enters the model.
    async fn call_tool(&self, tool_name: &str, arguments: &str)
        -> Result<RawToolOutput, ToolError>;
}
