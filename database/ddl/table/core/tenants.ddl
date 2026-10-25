-- database/ddl/table/core/tenants.ddl
set search_path to core, extensions;

create table if not exists tenants (
  id           uuid        primary key default gen_random_uuid()
, name         varchar     not null
, slug         varchar     not null unique
, domain       varchar     unique
, is_platform  boolean     not null default false
, status       core.tenant_status not null default 'trial'
, created_at   timestamptz not null default now()
, modified_at  timestamptz not null default now()
, modified_by  varchar     not null
  -- AG-7 (#36): a tenant is named by its id OR its slug (TORII_TENANT, torii_core::resolve_tenant),
  -- so a slug must never read as an id. Refused: anything that is 32 hex digits once a
  -- `urn:uuid:` prefix, braces and hyphens are stripped — a superset of every spelling both
  -- Postgres' uuid input and Rust's uuid::Uuid::parse_str accept. Org create (slugify in
  -- services/gateway/src/routes/rpc.rs) applies the same rule and prefixes such a slug `org-`.
, constraint tenants_slug_not_uuid
    check (regexp_replace(lower(slug), '^urn:uuid:|[{}-]', '', 'g') !~ '^[0-9a-f]{32}$')
);

-- At most one platform tenant at a time
create unique index if not exists tenants_platform_ukey
  on tenants(is_platform)
  where is_platform = true;

comment on table tenants is
'Central tenant registry. One row per tenant.
- slug: URL-safe identifier, unique, never UUID-shaped (tenants_slug_not_uuid)
- domain: optional email domain for auto-assignment (e.g. acme.com).
  When a new auth.users row is inserted, assign_tenant_by_domain() matches
  split_part(email, ''@'', 2) against this column.
- is_platform: exactly one tenant may have this set to true — the Seiki
  platform tenant (the operator that runs the torii gateway for everyone else).
  Users of this tenant can also manage the config schema
  (providers, models, routers). All other capabilities are identical to any
  other tenant.
- Tenant isolation is enforced via RLS (see policies/), not partitioning.';

-- Bootstrap the single platform tenant at apply time (idempotent). It owns
-- platform-default catalog (e.g. fallback chains) and must exist before seed import.
insert into tenants (id, name, slug, is_platform, status, modified_by)
values ('00000000-0000-0000-0000-000000000000', 'Seiki Platform', 'platform', true, 'active', 'seed')
on conflict (id) do nothing;
