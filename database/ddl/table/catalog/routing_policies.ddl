-- database/ddl/table/catalog/routing_policies.ddl
set search_path to catalog, core, extensions;
-- RW14 (C2): operator routing policy per chain (retry/timeout/region/health/breaker) — NOT hardcoded.
create table if not exists routing_policies (
  tenant_id       uuid        not null references core.tenants(id) on delete cascade
, chain_id        uuid        not null
, retry_attempts  integer     not null default 2
, backoff_ms      integer     not null default 800
, timeout_ms      integer     not null default 30000
, region_pin      varchar(24)
, health_interval_ms integer  not null default 10000
, breaker         jsonb       not null default '{}'
, modified_at     timestamptz not null default now()
, primary key (tenant_id, chain_id)
, foreign key (tenant_id, chain_id) references chains(tenant_id, id) on delete cascade
);
comment on table routing_policies is 'RW14: per-chain routing policy as operator config (no hardcoded constants). Service_role-write.';
