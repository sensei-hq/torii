-- database/ddl/table/public/access_groups.ddl
set search_path to public, extensions;

create table if not exists access_groups (
  tenant_id    uuid    not null
, id           uuid    not null default gen_random_uuid()
, level_id     uuid
, parent_id    uuid
, name         varchar not null
, description  text
, created_at   timestamptz not null default now()
, modified_at  timestamptz not null default now()
, modified_by  varchar     not null
, primary key (tenant_id, id)
, foreign key (tenant_id, level_id)
    references group_levels(tenant_id, id) on delete restrict
, foreign key (tenant_id, parent_id)
    references access_groups(tenant_id, id) on delete restrict
);

create index if not exists idx_access_groups_level
  on access_groups(tenant_id, level_id);

create index if not exists idx_access_groups_parent
  on access_groups(tenant_id, parent_id);

comment on table access_groups is
'Configurable group tree for document access control, typed by group_levels.
- tenant_id: partition key (renamed from org_id)
- level_id: optional FK to group_levels defining the tier (org, dept, team, etc.)
- parent_id: self-FK within tenant for hierarchical groups
- name/description: default-language values; translations in access_groups_lang
- Partitioned by tenant_id — one partition per tenant created automatically';
