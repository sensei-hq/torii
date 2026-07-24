-- database/ddl/table/public/provider_health.ddl
set search_path to public, core, extensions;
-- RW14 (C2): circuit-breaker / provider health state (per-instance for v1).
create table if not exists provider_health (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, router_id    uuid        not null
, state        varchar(12) not null default 'closed' check (state in ('closed','open','half-open'))
, failures     integer     not null default 0
, opened_at    timestamptz
, updated_at   timestamptz not null default now()
, primary key (tenant_id, router_id)
);
comment on table provider_health is 'RW14: circuit-breaker/health state per router. Service_role-write.';
