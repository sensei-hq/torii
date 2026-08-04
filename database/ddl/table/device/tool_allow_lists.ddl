-- database/ddl/table/device/tool_allow_lists.ddl
set search_path to device, core, extensions;   -- §D Phase 1 MOVE: public→device

-- RW3: per-(role × space) tool allow-list grant (default-deny — absent ⇒ blocked).
-- The gateway resolves this at tool-call time (X1). space_id null ⇒ all spaces for
-- the role; tool_name null ⇒ all tools on the server.
create table if not exists tool_allow_lists (
  tenant_id      uuid not null references core.tenants(id) on delete cascade
, id             uuid not null default gen_random_uuid()
, role_id        uuid not null references core.roles(id) on delete cascade
, space_id       uuid
, mcp_server_id  uuid not null references mcp_servers(id) on delete cascade
, tool_name      varchar(200)
, primary key (id)
);

create index if not exists idx_tool_allow_lists_scope
  on tool_allow_lists(tenant_id, role_id, space_id);

comment on table tool_allow_lists is
'RW3: (role × space) → allowed (server, tool) grants, default-deny. Resolved by
the gateway at tool-call time; service_role-write via Admin Tools&MCP.';
