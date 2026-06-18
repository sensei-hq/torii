set search_path to history, extensions;

create table if not exists past_mcp_servers (
  id               uuid primary key default uuid_generate_v4()
, server_id        uuid not null
, name             varchar(100) not null
, label            varchar(255) not null
, transport        varchar(20)  not null
, command          varchar(500)
, args             jsonb        not null default '[]'
, env              jsonb        not null default '{}'
, url              varchar(1000)
, is_active        boolean      not null default true
, version          integer      not null default 0
, modified_by      varchar
, effective_from   timestamptz
, effective_to     timestamptz
, operation        varchar(10)
, created_at       timestamptz  not null default now()
, updated_at       timestamptz           default now()
);

create unique index if not exists past_mcp_servers_ukey
    on past_mcp_servers(server_id, effective_from, effective_to);

create index if not exists past_mcp_servers_idx1
    on past_mcp_servers(server_id);

comment on table past_mcp_servers is
'History table for config.mcp_servers — auto-populated by the historize trigger.
- server_id references the original mcp_servers.id (not a FK to allow deletes)
- effective_from/effective_to track the validity period of each version
- operation records the triggering DML: INSERT, UPDATE, or DELETE';
