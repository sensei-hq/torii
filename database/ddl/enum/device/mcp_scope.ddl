-- database/ddl/enum/device/mcp_scope.ddl
set search_path to device;
-- db-redesign.md §3 device→tools enum: mcp_servers.scope (platform vs tenant MCP server).
-- Declaration order platform<tenant matches prior varchar alpha order → ledger order-by unchanged.
-- All writes/reads are literals/comparisons/json_agg → coerce; no Rust cast.
create type mcp_scope as enum ('platform', 'tenant');
