-- database/ddl/table/public/alert_events.ddl
set search_path to public, core, audit, extensions;
-- RW8: fired-alert log.
create table if not exists alert_events (
  tenant_id  uuid        not null references core.tenants(id) on delete cascade
, id         uuid        not null default gen_random_uuid()
, rule_id    uuid
, severity   audit.alert_severity not null default 'warning'
, summary    text        not null
, data       jsonb       not null default '{}'
, fired_at   timestamptz not null default now()
, primary key (tenant_id, id)
);
create index if not exists idx_alert_events_fired on alert_events(tenant_id, fired_at desc);
comment on table alert_events is 'RW8: emitted alert events (gateway-written).';
