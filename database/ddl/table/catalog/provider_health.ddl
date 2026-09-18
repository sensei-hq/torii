-- database/ddl/table/catalog/provider_health.ddl
set search_path to catalog, core, extensions;
-- RW14 (C2) + G4: router-level health — circuit-breaker state and connection cooldown.
-- Durable because the engine holds both in process, and torii-gateway suspends when idle
-- (fly.toml: min_machines_running = 0), losing that state on every idle period.
create table if not exists provider_health (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, router_id    uuid        not null
, state        catalog.breaker_state not null default 'closed'
, failures     integer     not null default 0
, opened_at    timestamptz
  -- G4: connection-cooldown deadline — the engine skips this router until it passes. Router
  -- grain (a connection fault is the router's, not one model's), which is this table's grain.
  -- Unlike endpoint_lockouts there is no terminal case: a connection fault always retries, so
  -- NULL here genuinely means "not cooling", and `cooling_until > now()` is the correct test.
, cooling_until timestamptz
, updated_at   timestamptz not null default now()
, primary key (tenant_id, router_id)
);
comment on table provider_health is
'RW14 + G4: per-router circuit-breaker state and connection-cooldown deadline. Durable so both
survive a suspend and are shared across instances. cooling_until NULL = not cooling (no
terminal case here, unlike catalog.endpoint_lockouts). Service_role-write.';
