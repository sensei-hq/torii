set search_path to public, extensions;

create table if not exists session_logs (
  tenant_id      uuid not null
, id             uuid not null default gen_random_uuid()
, user_id        text not null
, session_id     uuid not null
, parent_log_id  uuid
, event          text not null
, data           jsonb not null default '{}'
, created_at     bigint not null
, primary key (tenant_id, id)
, constraint session_logs_session_fkey foreign key (tenant_id, session_id)
    references sessions(tenant_id, id) on delete cascade
, constraint session_logs_parent_fkey foreign key (tenant_id, parent_log_id)
    references session_logs(tenant_id, id) on delete restrict
) partition by list (tenant_id);

create index if not exists idx_session_logs_session_id
  on session_logs(tenant_id, session_id);
create index if not exists idx_session_logs_event
  on session_logs(event);
create index if not exists idx_session_logs_created_at
  on session_logs(tenant_id, created_at);

comment on table session_logs is
'Event log for agent sessions.
- tenant_id: partition key (composite PK)
- user_id: denormalised from sessions — avoids join in hot query path
- Composite FK to sessions prevents cross-tenant log entries
- parent_log_id self-FK is composite to prevent cross-tenant references
- Timestamps are epoch milliseconds';
