-- database/ddl/enum/catalog/lock_reason.ddl
set search_path to catalog;
-- G4 catalog enum: catalog.endpoint_lockouts.reason — why an endpoint is locked out.
-- Mirrors the engine's `LockReason` (gateway::gates::lockout), in its declared order.
--
-- The split that matters is RECOVERABLE vs TERMINAL, and it is a property of the reason:
--   · rate_limit       — 429; recovers fast, honours Retry-After
--   · quota_exhausted  — provider quota for this model spent; recovers at a reset boundary
--   · credits_exhausted— out of credits/billing; TERMINAL until a human tops up
--   · auth             — 401 / bare 403; TERMINAL until the credential changes
-- `endpoint_lockouts` enforces that split structurally: a recoverable reason must carry a
-- deadline, a terminal one must not.
create type lock_reason as enum ('rate_limit', 'quota_exhausted', 'credits_exhausted', 'auth');
