-- database/ddl/table/public/fallback_chains.ddl
set search_path to public, core, config, extensions;

create table if not exists fallback_chains (
  tenant_id                    uuid        not null
    references core.tenants(id) on delete cascade
, id                           uuid        not null default gen_random_uuid()
, name                         varchar(100) not null
, capability_id                uuid        not null
    references config.capabilities(id)
, max_fallback_attempts        integer     not null default 3
, circuit_breaker_threshold    integer     not null default 5
, circuit_breaker_window_minutes integer   not null default 15
, is_active                    boolean     not null default true
, priority                     integer     not null default 0
, description                  text
, created_at                   timestamptz not null default now()
, modified_at                  timestamptz not null default now()
, modified_by                  varchar     not null
, primary key (tenant_id, id)
) partition by list (tenant_id);

create unique index if not exists fallback_chains_tenant_name_ukey
  on fallback_chains(tenant_id, name);

create index if not exists fallback_chains_capability_idx
  on fallback_chains(tenant_id, capability_id);

create index if not exists fallback_chains_active_idx
  on fallback_chains(tenant_id, is_active);

create index if not exists fallback_chains_priority_idx
  on fallback_chains(tenant_id, priority);

comment on table fallback_chains is
'Fallback chain configurations, scoped per tenant.
- tenant_id: partition key — platform tenant holds the default chains
- Tenants override platform chains by defining a chain with the same name
- is_active = false falls back to platform chain (not just silently hidden)
- Works with fallback_chain_models and effective_chain_models view';
