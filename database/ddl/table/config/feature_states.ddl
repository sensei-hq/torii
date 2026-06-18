set search_path to config, extensions;

create table if not exists feature_states (
  id                       uuid primary key default uuid_generate_v4()
, feature_id               uuid not null references features(id) on delete cascade
, user_id                  varchar(200) not null
, enabled                  boolean not null default true
, version                  integer not null default 0
, modified_by              varchar
, modified_at              timestamp with time zone not null default now()
);

create unique index if not exists feature_states_ukey on feature_states(feature_id, user_id);
create index if not exists feature_states_fkey1 on feature_states(feature_id);
create index if not exists feature_states_idx1 on feature_states(user_id);

comment on table feature_states is
'Per-user overrides for feature enabled/disabled state.
- When no row exists, the feature uses its module default (features.enabled)
- user_id is an opaque identifier (auth user ID, session ID, etc.)
- version is auto-incremented by the historize trigger';
