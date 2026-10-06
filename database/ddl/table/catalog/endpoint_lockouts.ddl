-- database/ddl/table/catalog/endpoint_lockouts.ddl
set search_path to catalog, core, extensions;

-- G4: durable model-lockout state, one row per (tenant, router, model) — the engine's
-- `"router:model"` endpoint key, FK-normalized the way torii stores everything else.
--
-- WHY IT IS DURABLE HERE: the engine keeps this in a process-local HashMap. torii-gateway
-- suspends when idle (fly.toml: min_machines_running = 0, auto_stop_machines = 'suspend'), so
-- in-process state is lost on every idle period, and a second machine past the concurrency
-- soft limit disagrees with the first about which endpoints are healthy. Persisting it makes
-- lockouts survive a suspend and be shared across instances.
create table if not exists endpoint_lockouts (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, router_id    uuid        not null references routers(id) on delete cascade
, model_id     uuid        not null references models(id) on delete cascade
, reason       lock_reason not null
  -- When the lock lifts. NULL means TERMINAL — a human must act (top up, rotate the key).
  -- NULL here does NOT mean "not locked": a row's existence is the lock. Read through
  -- catalog.endpoint_lockout_active, never with a bare `locked_until > now()`, which drops
  -- every terminal lock and fails OPEN on exactly the endpoints that most need blocking.
, locked_until timestamptz
  -- Escalation memory: how many times this endpoint has been locked. Retained PAST expiry so
  -- a repeat offender earns a longer cooldown; the engine keeps the entry for the same reason.
, escalation   integer     not null default 0
, first_locked_at timestamptz not null default now()
, updated_at   timestamptz not null default now()
, primary key (tenant_id, router_id, model_id)
  -- Terminality is structural, not a convention a writer might forget: a recoverable reason
  -- comes back on its own and MUST say when; a terminal one never does and MUST NOT pretend.
, constraint endpoint_lockouts_deadline_check check (
    (reason in ('rate_limit', 'quota_exhausted') and locked_until is not null)
    or (reason in ('credits_exhausted', 'auth')  and locked_until is null))
);

create index if not exists endpoint_lockouts_tenant_idx on endpoint_lockouts(tenant_id);
create index if not exists endpoint_lockouts_until_idx  on endpoint_lockouts(tenant_id, locked_until);

comment on table endpoint_lockouts is
'G4: durable per-endpoint (tenant, router, model) model-lockout state, mirroring the engine''s
in-process map so locks survive a suspend and are shared across instances.
locked_until NULL = TERMINAL (needs a human), NOT "unlocked" — read via
catalog.endpoint_lockout_active. Escalation memory is retained past expiry.';
