-- database/ddl/table/core/tenants.ddl
set search_path to core, extensions;

create table if not exists tenants (
  id           uuid        primary key default gen_random_uuid()
, name         varchar     not null
, slug         varchar     not null unique
, domain       varchar     unique
, is_platform  boolean     not null default false
, status       varchar     not null default 'trial'
    check (status in ('active', 'suspended', 'trial'))
, created_at   timestamptz not null default now()
, modified_at  timestamptz not null default now()
, modified_by  varchar     not null
);

-- At most one platform tenant at a time
create unique index if not exists tenants_platform_ukey
  on tenants(is_platform)
  where is_platform = true;

comment on table tenants is
'Central tenant registry. One row per tenant.
- slug: URL-safe identifier, unique
- domain: optional email domain for auto-assignment (e.g. acme.com).
  When a new auth.users row is inserted, assign_tenant_by_domain() matches
  split_part(email, ''@'', 2) against this column.
- is_platform: exactly one tenant may have this set to true — the Strategos
  platform tenant. Users of this tenant can also manage the config schema
  (providers, models, routers, shared MCP servers). All other capabilities
  (agentic chat, agents) are identical to any other tenant.
- add_tenant_partitions_trigger fires after insert to create per-tenant
  partitions across all public list-partitioned tables.';
