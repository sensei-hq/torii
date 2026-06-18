set search_path to config, extensions;

create table if not exists capabilities (
  id                       uuid primary key default uuid_generate_v4()
, name                     varchar not null
, description              text
, category                 varchar
, parameters               jsonb
, modified_at              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists capabilities_ukey on capabilities(name);
create index if not exists capabilities_idx1 on capabilities(category);

comment on table capabilities IS
'Model capability definitions.
- Centralized registry of capabilities (text_generation, image_generation, etc.)
- Used for model capability mapping and fallback chain configuration';
