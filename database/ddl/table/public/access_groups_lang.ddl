-- database/ddl/table/public/access_groups_lang.ddl
set search_path to public, extensions;

create table if not exists access_groups_lang (
  tenant_id    uuid    not null
, group_id     uuid    not null
, language     varchar not null
, name         varchar not null
, description  text
, modified_at  timestamptz not null default now()
, modified_by  varchar     not null
, primary key (tenant_id, group_id, language)
, foreign key (tenant_id, group_id)
    references access_groups(tenant_id, id) on delete cascade
);

comment on table access_groups_lang is
'Translated names and descriptions for access_groups.
Application reads this table for the active language first;
falls back to the base table value if no translation row exists.';
