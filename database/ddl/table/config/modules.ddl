set search_path to config, extensions;

create table if not exists modules (
  id                       uuid primary key default uuid_generate_v4()
, slug                     varchar(100) not null
, name                     varchar(200) not null
, title                    varchar(200) not null
, description              text
, persona                  varchar(100)
, sequence                 integer default 0
, is_active                boolean default true
, modified_at              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists modules_slug_ukey on modules(slug);
create index if not exists modules_idx1 on modules(is_active);
create index if not exists modules_idx2 on modules(sequence);

comment on table modules is
'Application modules — each module is a distinct agent-powered experience (e.g. curator, operator).
- slug is the URL segment and unique identifier
- name is the display name for menus, headers, and breadcrumbs
- persona is the AI character name shown in the UI';
