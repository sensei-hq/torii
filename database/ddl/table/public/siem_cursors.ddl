-- database/ddl/table/public/siem_cursors.ddl
set search_path to public, extensions;

-- O1 (P6): per-(tenant, channel) SIEM streaming cursor. The streamer ships
-- `audit_events` ordered by the monotonic (created_at, id) key and records the last
-- shipped position here, so it resumes after a restart and never advances past an
-- unacknowledged batch (at-least-once). service_role-only (the gateway); no client access.
create table if not exists siem_cursors (
  tenant_id       uuid not null references core.tenants(id) on delete cascade
, channel_id      uuid not null
, last_created_at timestamptz not null default 'epoch'
, last_id         uuid
, updated_at      timestamptz not null default now()
, primary key (tenant_id, channel_id)
);

alter table siem_cursors enable row level security;
-- no policies → authenticated/anon get nothing; the gateway connects as the owner
-- (RLS-bypassing) and is the sole reader/writer.

comment on table siem_cursors is
'O1 SIEM streaming cursor: last (created_at, id) of audit_events shipped per
(tenant, notification_channel). Enables resume-after-restart + at-least-once.';
