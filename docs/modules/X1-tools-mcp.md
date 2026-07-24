# X1 · Tools & MCP

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Cross-cutting (X) · **Status:** In v1 · **Depends on:** C1, D1, W1

## Purpose

Tool-calling and Model Context Protocol integration — let models invoke tools and connect external MCP servers. Present in the old system; a new **Tools & MCP** admin screen is authored in the designer handoff (§6) — it is not yet in the current mockups.

## What we build

- **Tool / MCP-server registry** + **per-(role×space) tool allow-lists** (`mcp_servers` + `tenant_mcp_servers` + a tool-allow-list table in the F1 v1 cut; wire the orphan `mcp_servers.jsonl` seed).
- **MCP servers**: `stdio` transport on the device (via D1) and `http`/`sse` shared servers registered centrally (per-tenant + platform).
- **Gateway enforces the allow-list at tool-call time** (server-side, not UI-only): **SSRF-filter** `http`/`sse` tools, **sandbox** `stdio` tools.
- **Tool-egress redaction** (§2 W5): MCP tool **inputs/outputs are scanned + redacted** (secrets/PII) before egressing to any model or tool; each redaction is a quality/audit signal (§3b).
- Surfaced in a new Admin **Tools & MCP** screen (register servers, edit allow-lists) and available to chat/agents.

## Reuse / source

`strategos_old` `tools` + `mcp-client` packages; `database/` `mcp_servers` / `tenant_mcp_servers` (+ tool-allow-list). The engine is the six `sensei-*` crates @ `v0.4.6`; whether MCP / tool-calling is exposed there (vs. built consumer-side and enforced in C1/C4) is a **gateway-repo question** — see crate issues.

## Decision

**RESOLVED — in v1** (DECISIONS §1.1). Registry + per-(role×space) allow-lists ship in v1; the gateway enforces at tool-call time (SSRF-filter `http`, sandbox `stdio`) with tool-egress redaction (§2 W5). `mcp_servers` / `tenant_mcp_servers` / tool-allow-list tables are **in** the F1 v1 cut.
