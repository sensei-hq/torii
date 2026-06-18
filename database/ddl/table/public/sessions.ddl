set search_path to public, extensions;

create table if not exists sessions (
  tenant_id           uuid not null
, id                  uuid not null default gen_random_uuid()
, user_id             text not null
, module_id           uuid not null
, previous_session_id uuid
, status              text not null default 'active'
    check (status in ('active', 'completed', 'failed', 'cancelled'))
, created_at          bigint not null
, completed_at        bigint
, duration_ms         bigint
, primary key (tenant_id, id)
, constraint sessions_module_fkey foreign key (module_id)
    references config.modules(id) on delete restrict
, constraint sessions_previous_fkey foreign key (tenant_id, previous_session_id)
    references sessions(tenant_id, id) on delete restrict
) partition by list (tenant_id);

create index if not exists idx_sessions_user_id     on sessions(tenant_id, user_id);
create index if not exists idx_sessions_module_id   on sessions(module_id);
create index if not exists idx_sessions_status      on sessions(status);
create index if not exists idx_sessions_created_at  on sessions(tenant_id, created_at desc);

comment on table sessions is
'Agent session tracking.
- tenant_id: partition key (composite PK)
- user_id: identity of the user who owns this session (opaque string, e.g. Supabase auth UID)
- previous_session_id self-FK is composite to prevent cross-tenant references
- module_id references config.modules(id) — config is shared (not partitioned)
- Timestamps are epoch milliseconds';
