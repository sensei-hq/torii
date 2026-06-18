set search_path to staging;

create table if not exists mcp_servers (
  name                     varchar(100) not null
, label                    varchar(255) not null
, transport                varchar(20) default 'stdio'
, command                  varchar(500)
, args                     jsonb default '[]'
, env                      jsonb default '{}'
, url                      varchar(1000)
, is_active                boolean default true
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists mcp_servers_ukey on mcp_servers(name);
