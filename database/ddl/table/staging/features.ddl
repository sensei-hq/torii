set search_path to staging;

create table if not exists features (
  module_slug              varchar(100) not null
, slug                     varchar(100) not null
, title                    varchar(200) not null
, description              text
, purpose                  text
, benefit                  text
, example                  text
, enabled                  boolean default true
, mandatory                boolean default false
, sequence                 integer default 0
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists features_ukey on features(module_slug, slug);
