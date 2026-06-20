-- database/ddl/table/public/group_levels_lang.ddl
set search_path to public, extensions;

create table if not exists group_levels_lang (
  tenant_id       uuid    not null
, group_level_id  uuid    not null
, language        varchar not null
, name            varchar not null
, description     text
, modified_at     timestamptz not null default now()
, modified_by     varchar     not null
, primary key (tenant_id, group_level_id, language)
, foreign key (tenant_id, group_level_id)
    references group_levels(tenant_id, id) on delete cascade
);

comment on table group_levels_lang is
'Translated names and descriptions for group_levels.
Application reads this table for the active language first;
falls back to the base table value if no translation row exists.';
