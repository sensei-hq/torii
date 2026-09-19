-- database/ddl/table/config/resilience.ddl
set search_path to config, extensions;

-- G5: operator-tunable resilience policy — the durable home for the engine's
-- `ResilienceConfig` (crates/gateway/src/resilience.rs) + `ModelLockoutPolicy`.
-- Upholds the project rule that operational behaviour is operator-managed config, never
-- hardcoded constants: every value here has an engine constant as its overridable fallback.
--
-- WHY NOT catalog.routing_policies. That table is keyed (tenant_id, chain_id) — per chain.
-- ResilienceConfig is PROCESS-GLOBAL: one `Gateway::with_resilience` call configures the whole
-- gateway, and there is exactly one cooldown store, one lockout store and one performance
-- window per process, shared across every tenant. Per-chain storage would let two chains in a
-- tenant declare different eviction caps while the engine can honour only one — config that
-- reads as applied and silently is not. routing_policies keeps its genuinely per-chain fields
-- (retry/backoff/timeout/region/health-interval); this is a different grain, not an extension.
--
-- WHY A SINGLETON. torii-gateway is ONE multi-tenant process per deployment, so this is
-- deployment config. Note this is the same `id boolean` shape criticised in gateway's
-- orchestrator.config_versions — the objection there was that it forced TENANT data to be
-- global (one tenant's publish killing another tenant's runs). Here the value genuinely is
-- process-global, so a second row could only create ambiguity about which one was loaded.
--
-- DEFAULTS ARE LOAD-BEARING. They reproduce the engine's defaults exactly, so merely HAVING a
-- row changes nothing. A drift between these and the engine's constants would silently alter
-- production routing while looking like configuration — tests/resilience_config.sql pins all
-- nine against the engine.
--
-- Durations are stored in MILLISECONDS (the engine holds `Duration`); the `_ms` suffix is the
-- unit contract, so a caller cannot mistake seconds for millis.
create table if not exists resilience (
  id                          boolean     primary key default true
  -- Base router cooldown after a transport fault (Network/Timeout). Engine: 30s.
, cooldown_base_ms            integer     not null default 30000
  -- Per-store retention cap; expired entries are evicted above it. Engine: 4096.
, eviction_cap                integer     not null default 4096
  -- Deterministic jitter added to SYNTHETIC deadlines to spread retries. 0.0 = off (today's
  -- behaviour). A real upstream Retry-After is never jittered.
, jitter_fraction             numeric(4,3) not null default 0.0
  -- Rolling performance window: how many samples per endpoint, and how long they stay live.
  -- Engine: 64 samples / 300s. Changing either forces the engine to rebuild the store,
  -- discarding samples recorded before the change.
, perf_samples                integer     not null default 64
, perf_window_ms              integer     not null default 300000
  -- Minimum live observations before a metric sort trusts a candidate's mean. Engine: 3.
, min_samples                 integer     not null default 3
  -- ModelLockoutPolicy: per-reason lockout durations + the escalation clamp.
  -- Engine: 60s / 3600s / 6h.
, lockout_rate_limit_base_ms  integer     not null default 60000
, lockout_quota_default_ms    integer     not null default 3600000
, lockout_max_cooldown_ms     integer     not null default 21600000
, modified_at                 timestamptz not null default now()
, modified_by                 varchar
  -- Exactly one row: `id` is the constant true, so a second insert collides on the PK.
, constraint resilience_singleton_check check (id)
  -- A fraction, not a multiplier: >= 1.0 would double a deadline rather than spread it, and a
  -- negative value would pull it into the past, expiring a cooldown that never ran.
, constraint resilience_jitter_check check (jitter_fraction >= 0.0 and jitter_fraction < 1.0)
  -- NOT zero. The engine's own hazard note: an endpoint whose ring holds live samples while
  -- the counter being read sits at 0 reports a mean of 0.0, which a metric sort reads as a
  -- MEASUREMENT — so the endpoint "wins every race it has never run". Any value >= 1 makes
  -- that unreachable.
, constraint resilience_min_samples_check check (min_samples >= 1)
  -- Durations and capacities are positive by construction.
, constraint resilience_positive_check check (
    cooldown_base_ms > 0 and eviction_cap > 0 and perf_samples > 0 and perf_window_ms > 0
    and lockout_rate_limit_base_ms > 0 and lockout_quota_default_ms > 0
    and lockout_max_cooldown_ms > 0)
);

comment on table resilience is
'G5: deployment-scoped resilience policy mirroring the engine ResilienceConfig +
ModelLockoutPolicy. Singleton because the engine applies it per PROCESS, not per tenant or
chain — catalog.routing_policies is the per-chain grain and is deliberately NOT extended here.
Column defaults reproduce the engine defaults exactly, so a default row changes no behaviour.';
