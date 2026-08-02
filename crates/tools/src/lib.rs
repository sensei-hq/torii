//! `tools` — Torii's MCP tool runtime.
//!
//! A **consumer-side** security library (mirrors the C4 governance pattern) compiled into two
//! hosts: the central gateway (C1) and the desktop `src-tauri`. It provides:
//!
//! - **Default-deny `(role × space)` allow-list resolution** ([`resolver`], central/DB only)
//!   producing an [`AllowedToolSet`] — a tool absent from a caller's resolved set is never
//!   offered and never executed.
//! - **Server-side enforcement at tool-call time** ([`invoker`]) — an invoke-time re-check
//!   against the allowed set, so a forged tool call is blocked before any transport is reached.
//! - **SSRF-filtered http/sse egress** and **device-only stdio** ([`egress`], [`client`]).
//! - **Fail-closed W5 tool-egress redaction** on both tool input and output.
//!
//! Enforcement, SSRF, sandboxing, and redaction are **Torii-owned and live here — never in the
//! `sensei-*` engine** (GH-7 / DECISIONS §1.1). The engine only carries tool *schemas*; this
//! crate is engine-independent (the gateway maps `ToolDef`/`ToolInvocation` to/from the engine
//! types at its boundary).

pub mod agentic;
pub mod client;
#[cfg(feature = "db")]
pub mod discovery;
pub mod egress;
pub mod error;
pub mod invoker;
pub mod resolver;
pub mod types;

pub use agentic::{run_tool_loop, LoopResult, ModelTurn, ToolLoopConfig, ToolResultMessage, TurnOutput};
pub use client::{DiscoveredTool, McpClient, RawToolOutput};
#[cfg(feature = "db")]
pub use discovery::discover_and_cache;
pub use egress::{is_blocked_ip, EgressFilter, EgressPolicy, PinnedTarget, Resolver, StdResolver};
pub use error::ToolError;
pub use invoker::{InvokeCtx, ToolAudit, ToolAuditSink, ToolInvoker, ToolRedactor, ToolTransport};
#[cfg(feature = "db")]
pub use resolver::AllowListResolver;
pub use resolver::{build_allowed_set, parse_transport, ResolveCtx, ResolvedRow};
pub use types::{
    offered_name, AllowedToolSet, Direction, Plane, RedactionSummary, ToolBinding, ToolDef,
    ToolInvocation, ToolKey, ToolOutcome, ToolProvenance, ToolResult, Transport,
};
