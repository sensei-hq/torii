-- database/ddl/table/catalog/routers.ddl
set search_path to catalog, extensions;

-- §D move: catalog.routers → catalog.routers (config→catalog, db-redesign.md §37). Router/adapter
-- catalog; router_type/auth_type are catalog enums. Global reference data (no tenant_id, no RLS).
create table if not exists routers (
  id                       uuid primary key default uuid_generate_v4()
, name                     varchar(100) not null unique
, display_name             varchar(200)
, description              text
, router_type              catalog.router_type not null
, website_url              varchar(500)
, documentation_url        varchar(500)
, api_base_url             varchar(500)
, api_key_env_var          varchar(200)
, authentication_type      catalog.auth_type default 'api_key'
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
, modified_at              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists routers_ukey on routers(name);
create index if not exists routers_idx1 on routers(display_name);
create index if not exists routers_idx2 on routers(router_type);
create index if not exists routers_idx3 on routers(is_active);
create index if not exists routers_idx4 on routers(sequence);

comment on table routers IS
'AI model routing services and API endpoints.
- Distinguishes between direct providers (OpenAI, Anthropic) and aggregators (OpenRouter, AWS Bedrock)
- Includes authentication, rate limiting, and region configuration
- Used for routing requests to appropriate endpoints based on availability and cost';
