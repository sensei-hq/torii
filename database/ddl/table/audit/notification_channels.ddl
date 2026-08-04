-- database/ddl/table/audit/notification_channels.ddl
set search_path to audit, core, extensions;
-- RW8: alert delivery channels (email/slack/webhook/siem). Also the SIEM sink (D4/O1).
-- §D Phase 1 MOVE: relocated public→audit (background-only; read by the SIEM streamer).
create table if not exists notification_channels (
  tenant_id  uuid        not null references core.tenants(id) on delete cascade
, id         uuid        not null default gen_random_uuid()
, kind       audit.channel_kind not null
, target     text        not null
, config     jsonb       not null default '{}'
, enabled    boolean     not null default true
, created_at timestamptz not null default now()
, primary key (tenant_id, id)
);
comment on table notification_channels is 'RW8: alert/SIEM delivery channels (audit domain). Service_role-write.';
