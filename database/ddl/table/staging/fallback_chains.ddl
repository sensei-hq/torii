set search_path to staging;

create table if not exists fallback_chains (
  capability_name            varchar not null
, name                       varchar(100) not null
, max_fallback_attempts      integer default 3
, circuit_breaker_threshold  integer default 5
, circuit_breaker_window_minutes integer default 15
, is_active                  boolean default true
, priority                   integer default 0
, description                text
, modified_at                timestamp with time zone default now()
, modified_by                varchar default current_user
);

create unique index if not exists fallback_chains_ukey on fallback_chains(capability_name, name);
