set search_path to history, audit, extensions;

create table if not exists past_feature_states (
  id               uuid primary key default uuid_generate_v4()
, user_id          varchar(200) not null
, state_id         uuid not null
, feature_id       uuid not null
, enabled          boolean not null default true
, version          integer not null default 0
, modified_by      varchar
, effective_from   timestamptz
, effective_to     timestamptz
, operation        audit.operation
, modified_at      timestamptz not null default now()
);

create unique index if not exists past_feature_states_ukey
    on past_feature_states(state_id, effective_from, effective_to);

create index if not exists past_feature_states_idx1
    on past_feature_states(state_id);

comment on table past_feature_states is
'History table for config.feature_states — auto-populated by the historize trigger.
- state_id references the original feature_states.id (not a FK to allow deletes)
- effective_from/effective_to track the validity period of each version
- operation records the triggering DML: INSERT, UPDATE, or DELETE';
