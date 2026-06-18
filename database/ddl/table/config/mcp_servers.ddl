set search_path to config, extensions;

create table if not exists mcp_servers (
  id           uuid         primary key default uuid_generate_v4()
, name         varchar(100) not null unique
, label        varchar(255) not null
, transport    varchar(20)  not null default 'stdio' check (transport in ('stdio', 'sse', 'streamable-http'))
, command      varchar(500)
, args         jsonb        not null default '[]'
, env          jsonb        not null default '{}'
, url          varchar(1000)
, is_active    boolean      not null default true
, version      integer      not null default 0
, modified_by  varchar
, created_at   timestamptz  not null default now()
, updated_at   timestamptz           default now()
);

create unique index if not exists mcp_servers_ukey on mcp_servers(name);
create index if not exists mcp_servers_idx1 on mcp_servers(is_active);
create index if not exists mcp_servers_idx2 on mcp_servers(transport);

comment on table mcp_servers IS
'Registered MCP (Model Context Protocol) servers that Strategos agents can use as tool sources.
- Each server exposes tools via stdio, SSE, or streamable-http transport
- Tool lists are fetched on-demand via /v1/mcp/servers/:id/tools
- is_active controls whether the server is available to agents at runtime';
