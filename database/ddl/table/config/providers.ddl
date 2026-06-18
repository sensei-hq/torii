set search_path to config, extensions;

create table if not exists providers (
  id                       uuid primary key default uuid_generate_v4()
, name                     varchar(200) not null unique
, description              text
, website_url              varchar(500)
, founded_year             integer
, headquarters             varchar(200)
, specialization           text
, is_active                boolean default true
, is_open_source           boolean default false
, sequence                 integer default 0
, modified_at              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists providers_ukey on providers(name);
create index if not exists providers_idx1 on providers(is_active);
create index if not exists providers_idx2 on providers(sequence);

comment on table providers IS
'AI model providers and creators.
- Stores information about companies and organizations that create AI models
- Distinguishes from routers which provide access to models
- Used for attribution, licensing, and model categorization';
