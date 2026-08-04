-- database/ddl/enum/governance/config_scope.ddl
set search_path to governance;
-- db-redesign.md §3 governance enum: settings.scope (workspace vs space-scoped config KV).
-- All writes/reads are literals/comparisons → coerce; no Rust cast. Value set = live CHECK
-- {workspace,space}; a 'tenant' scope decision is deferred to the settings-consolidation phase.
create type config_scope as enum ('workspace', 'space');
