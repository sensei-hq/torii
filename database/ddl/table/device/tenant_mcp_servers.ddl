-- database/ddl/table/device/tenant_mcp_servers.ddl
set search_path to device, core, extensions;   -- §D Phase 1 MOVE: public→device

-- RW3: a tenant opting a platform (or its own) MCP server in/out + config override.
create table if not exists tenant_mcp_servers (
  tenant_id       uuid    not null references core.tenants(id) on delete cascade
, mcp_server_id   uuid    not null references mcp_servers(id) on delete cascade
, enabled         boolean not null default true
, config_override jsonb   not null default '{}'
, primary key (tenant_id, mcp_server_id)
);

comment on table tenant_mcp_servers is
'RW3: per-tenant enablement/config of an MCP server. Service_role-write.';
