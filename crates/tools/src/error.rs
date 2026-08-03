use thiserror::Error;

/// Failures inside the tool runtime. Block *outcomes* (not-allowed, SSRF, fail-closed
/// redaction) are modelled on [`crate::types::ToolOutcome`] and surface as a `ToolResult`;
/// `ToolError` is for hard faults in the plumbing (transport, DB, bad config). Error text is
/// operator-facing — it must never carry raw tool arguments/outputs or decrypted secrets.
#[derive(Debug, Error)]
pub enum ToolError {
    /// The requested egress target failed the SSRF policy (private/loopback/metadata/rebind).
    #[error("ssrf blocked: {0}")]
    Ssrf(String),
    /// A stdio transport was constructed on the central plane — device-only (D2).
    #[error("stdio tools run on the device plane only")]
    DeviceOnly,
    /// W5 redaction could not complete; fail-closed (raw text must never pass through).
    #[error("redaction fail-closed: {0}")]
    RedactionFailClosed(String),
    /// A transport-level failure talking to an MCP server (connect/protocol/timeout).
    #[error("transport error: {0}")]
    Transport(String),
    /// A malformed or unreachable server/tool configuration.
    #[error("invalid tool configuration: {0}")]
    Config(String),
    #[cfg(feature = "db")]
    #[error("allow-list store error: {0}")]
    Db(String),
}

#[cfg(feature = "db")]
impl From<sqlx::Error> for ToolError {
    fn from(e: sqlx::Error) -> Self {
        // Don't leak raw sqlx/Postgres text (table/constraint names) upward to a client.
        ToolError::Db(e.to_string())
    }
}
