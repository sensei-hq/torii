set search_path to config, extensions;

create table if not exists features (
  id                       uuid primary key default uuid_generate_v4()
, module_id                uuid not null references modules(id) on delete cascade
, slug                     varchar(100) not null
, title                    varchar(200) not null
, description              text
, purpose                  text
, benefit                  text
, example                  text
, enabled                  boolean default true
, mandatory                boolean default false
, sequence                 integer default 0
, modified_at              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists features_ukey on features(module_id, slug);
create index if not exists features_fkey1 on features(module_id);
create index if not exists features_idx1 on features(enabled);
create index if not exists features_idx2 on features(mandatory);
create index if not exists features_idx3 on features(sequence);

comment on table features is
'Toggleable features within a module.
- Each feature belongs to a module and can be enabled/disabled per user
- mandatory features cannot be disabled by users';
