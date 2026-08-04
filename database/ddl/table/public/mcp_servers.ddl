-- database/ddl/table/public/mcp_servers.ddl
set search_path to public, core, device, extensions;

-- RW3 (decision #1, MCP in v1): registered MCP servers. scope=platform (tenant_id
-- null, shared) or tenant (tenant-owned). stdio = device-registrable only (X1 §5).
create table if not exists mcp_servers (
  tenant_id        uuid                                  -- null ⇒ platform-scoped
, id               uuid        not null default gen_random_uuid()
, scope            device.mcp_scope not null default 'tenant'
, name             varchar(120) not null
, label            varchar(200)
, transport        device.mcp_transport not null
, command          text                                  -- stdio
, args             jsonb       not null default '[]'
, url              text                                  -- http/sse
, auth_credential_id uuid                                -- optional router_credential for auth
, enabled          boolean     not null default true
, created_at       timestamptz not null default now()
, created_by       varchar     not null default 'system'
, primary key (id)
);

create index if not exists idx_mcp_servers_tenant on mcp_servers(tenant_id);

comment on table mcp_servers is
'RW3: MCP server registry. Service_role-write (Admin Tools&MCP via the gateway).
Gateway enforces the per-(role×space) tool allow-list at tool-call time.';
