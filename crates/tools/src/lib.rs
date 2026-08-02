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

pub mod error;
pub mod types;

pub use error::ToolError;
pub use types::{
    offered_name, AllowedToolSet, Direction, Plane, RedactionSummary, ToolBinding, ToolDef,
    ToolInvocation, ToolKey, ToolOutcome, ToolProvenance, ToolResult, Transport,
};
