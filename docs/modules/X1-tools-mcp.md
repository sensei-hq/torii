# X1 · Tools & MCP  *(pending decision #1)*

**Plane:** Pending · **Status:** Decision needed · **Depends on:** C1, D1

## Purpose
Tool-calling and Model Context Protocol integration — let models invoke tools and connect external MCP servers. Present in the old system; dropped from the current mockups.

## What we'd build (if in scope)
- **Tool registry** + allow-lists per role/space.
- **MCP servers**: `stdio` transport on the device (via D1) and `http`/`sse` shared servers registered centrally (per-tenant + platform).
- Surfaced in Admin (register servers, allow-lists) and available to chat/agents.

## Reuse / source
`strategos_old` `tools` + `mcp-client` packages; Sensei `mcp` crate; `database/` `mcp_servers` / `tenant_mcp_servers`.

## Decision
**In v1, or later?** (open decision #1). If deferred, omit `mcp_servers` tables from the F1 v1 cut.
