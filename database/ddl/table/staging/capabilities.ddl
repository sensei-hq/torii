set search_path to staging;

create table if not exists capabilities (
  name                     varchar not null
, category                 varchar
, description              text
, parameters               jsonb
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists capabilities_ukey on capabilities(name);
