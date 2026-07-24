-- database/ddl/table/public/mcp_server_tools.ddl
set search_path to public, core, extensions;

-- RW3/RW15: discovered-tool cache per MCP server (from tools/list). The allow-list
-- references these by (server, tool_name).
create table if not exists mcp_server_tools (
  id             uuid        not null default gen_random_uuid()
, mcp_server_id  uuid        not null references mcp_servers(id) on delete cascade
, tool_name      varchar(200) not null
, json_schema    jsonb       not null default '{}'
, is_active      boolean     not null default true
, discovered_at  timestamptz not null default now()
, primary key (id)
, unique (mcp_server_id, tool_name)
);

comment on table mcp_server_tools is
'RW3/RW15: discovered/offered tool cache (name + JSON-Schema) per MCP server.
Refreshed by /rpc/mcp/refresh-tools. Service_role-write.';
