-- database/ddl/table/governance/settings.ddl
set search_path to governance, public, core, extensions;

create table if not exists settings (
  tenant_id   uuid not null
    references core.tenants(id) on delete cascade
, id          uuid not null default gen_random_uuid()
, scope       governance.config_scope not null default 'workspace'
, space_id    uuid                       -- required when scope = 'space'
, key         varchar(100) not null
, value       jsonb not null default '{}'
, modified_at timestamptz not null default now()
, modified_by varchar not null
, primary key (tenant_id, id)
, unique nulls not distinct (tenant_id, scope, space_id, key)
, foreign key (tenant_id, space_id)
    references spaces(tenant_id, id) on delete cascade
);

comment on table settings is
'Workspace- and space-scoped settings — the 3-level control model''s upper layers
(workspace default → space override; user preferences live client-side).
- scope=space uses space_id (FK to spaces); scope=workspace leaves it null.
- unique nulls not distinct: one row per (tenant, scope, space, key).';
