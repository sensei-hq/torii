set search_path to staging;

create table if not exists modules (
  slug                     varchar(100) not null
, name                     varchar(200) not null
, title                    varchar(200) not null
, description              text
, persona                  varchar(100)
, sequence                 integer default 0
, is_active                boolean default true
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists modules_ukey on modules(slug);
