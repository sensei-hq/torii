-- database/ddl/table/public/group_levels.ddl
set search_path to public, extensions;

create table if not exists group_levels (
  tenant_id        uuid    not null
, id               uuid    not null default gen_random_uuid()
, code             varchar not null
, name             varchar
, depth            integer not null default 0
, parent_level_id  uuid
, description      text
, modified_at      timestamptz not null default now()
, modified_by      varchar     not null
, primary key (tenant_id, id)
, unique (tenant_id, code)
, foreign key (tenant_id, parent_level_id)
    references group_levels(tenant_id, id) on delete restrict
) partition by list (tenant_id);

create index if not exists idx_group_levels_depth
  on group_levels(tenant_id, depth);

comment on table group_levels is
'Per-tenant hierarchy tier definitions for access groups.
- code: stable slug (e.g. org, dept, team) — unique within tenant
- depth: 0 = root level, 1 = next, etc. (informational)
- parent_level_id: which level is valid as a parent (self-FK within tenant)
- name/description: default-language values; translations in group_levels_lang
- Partitioned by tenant_id — one partition per tenant created automatically';
