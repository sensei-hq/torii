-- database/ddl/enum/keyvault/refresh_status.ddl
set search_path to keyvault;
-- db-redesign.md §3 vault enum (schema renamed vault→keyvault). router_credentials.refresh_status —
-- the OAuth token-refresh outcome. Nullable, zero code readers/writers today (the refresh worker is
-- deferred/config-gated off) → additive: this replaces an UNCONSTRAINED varchar(16) with a typed set.
create type refresh_status as enum ('ok', 'failed');
