-- database/ddl/table/public/tenant_mcp_servers.ddl
set search_path to public, extensions;

create table if not exists tenant_mcp_servers (
  tenant_id   uuid    not null
, id          uuid    not null default gen_random_uuid()
, name        varchar not null
, label       varchar
, transport   varchar not null
    check (transport in ('sse', 'streamable-http'))
, url         varchar not null
, env         jsonb
, is_active   boolean not null default true
, version     integer not null default 1
, modified_at timestamptz not null default now()
, modified_by varchar     not null
, primary key (tenant_id, id)
, unique (tenant_id, name)
) partition by list (tenant_id);

create index if not exists idx_tenant_mcp_servers_active
  on tenant_mcp_servers(tenant_id, is_active);

comment on table tenant_mcp_servers is
'Per-tenant HTTP MCP server registrations.
- transport: sse or streamable-http only (stdio not viable in cloud)
- env: runtime environment variables passed to the MCP client
- version: optimistic locking counter
- Partitioned by tenant_id — one partition per tenant created automatically';
