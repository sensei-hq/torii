-- database/ddl/table/public/provider_overrides.ddl
set search_path to public, core, config, extensions;
-- RW10: per-tenant provider enable/disable over config.providers.
create table if not exists provider_overrides (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, id           uuid        not null default gen_random_uuid()
, provider_id  uuid        not null references config.providers(id) on delete cascade
, enabled      boolean     not null default true
, modified_at  timestamptz not null default now()
, modified_by  varchar     not null default 'system'
, primary key (tenant_id, id)
, unique (tenant_id, provider_id)
);
comment on table provider_overrides is 'RW10: per-tenant provider enablement. Service_role-write.';
