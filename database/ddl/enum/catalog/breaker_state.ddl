-- database/ddl/enum/catalog/breaker_state.ddl
set search_path to catalog;
-- db-redesign.md §3 catalog enum: provider_health.state (persisted circuit-breaker state, RW14).
-- The runtime breaker is the gateway crate's in-memory CircuitBreakerManager; this table is the
-- service_role-written persistence (no gateway-code reads/writes yet). Empty table, no deps.
create type breaker_state as enum ('closed', 'open', 'half-open');
