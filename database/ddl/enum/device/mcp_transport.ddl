-- database/ddl/enum/device/mcp_transport.ddl
set search_path to device;
-- db-redesign.md §3 device→tools enum: mcp_servers.transport. Bound write (register-server)
-- casts $N::device.mcp_transport; TWO production typed String reads cast ::text — mcp.rs
-- refresh_tools AND crates/tools resolver.rs (the /v1/chat MCP tool-resolution hot path).
create type mcp_transport as enum ('stdio', 'http', 'sse');
