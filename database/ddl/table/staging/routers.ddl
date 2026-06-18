set search_path to staging;

create table if not exists routers (
  name                     varchar(100) not null
, display_name             varchar(200)
, description              text
, router_type              varchar(20)
, website_url              varchar(500)
, documentation_url        varchar(500)
, api_base_url             varchar(500)
, api_key_env_var          varchar(200)
, authentication_type      varchar(50)
, default_headers          jsonb
, supported_auth_methods   jsonb
, regions                  jsonb
, rate_limits              jsonb
, pricing_info_url         varchar(500)
, status_page_url          varchar(500)
, is_active                boolean default true
, is_enterprise            boolean default false
, requires_approval        boolean default false
, sequence                 integer default 0
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists routers_ukey on routers(name);
