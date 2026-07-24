-- database/ddl/table/public/alert_rules.ddl
set search_path to public, core, extensions;
-- RW8: alert rules (budget breach, outage, policy hit, anomaly, …).
create table if not exists alert_rules (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, id          uuid        not null default gen_random_uuid()
, name        varchar(160) not null
, kind        varchar(24) not null
, severity    varchar(12) not null default 'warning' check (severity in ('info','warning','critical'))
, trigger     jsonb       not null default '{}'
, channel_ids uuid[]      not null default '{}'
, armed       boolean     not null default true
, created_at  timestamptz not null default now()
, primary key (tenant_id, id)
);
comment on table alert_rules is 'RW8: alert rules → channels. Service_role-write.';
