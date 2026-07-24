-- database/ddl/table/config/config_versions.ddl
set search_path to config, core, extensions;
-- RW15 (D4): one monotonic per-tenant config version + component sub-versions for delta sync.
create table if not exists config_versions (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, version     bigint      not null default 1
, components  jsonb       not null default '{}'
, updated_at  timestamptz not null default now()
, primary key (tenant_id)
);
comment on table config_versions is 'RW15 (D4): per-tenant config_version + component sub-version map for coherent atomic reload / delta pulls.';
