set search_path to staging;

create table if not exists providers (
  name                     varchar(200) not null
, description              text
, website_url              varchar(500)
, founded_year             integer
, headquarters             varchar(200)
, specialization           text
, is_active                boolean default true
, is_open_source           boolean default false
, sequence                 integer default 0
, modified_at              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists providers_ukey on providers(name);
