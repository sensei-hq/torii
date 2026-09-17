-- database/ddl/enum/catalog/free_type.ddl
set search_path to catalog;
-- G1 catalog enum: catalog.models.free_type — the shape of a model's free allowance.
-- Mirrors the gateway's `FreeType` (kernel::types::config). Wire format there is PascalCase
-- (`RecurringDaily`); the config_loader maps snake_case ↔ PascalCase at the boundary.
-- `recurring_*` are steady allowances that renew; `one_time_initial` is signup credit and is
-- EXCLUDED from the steady headline; `recurring_uncapped` is listed but never summed.
create type free_type as enum (
  'recurring_daily', 'recurring_monthly', 'recurring_credit', 'recurring_uncapped',
  'one_time_initial', 'keyless', 'discontinued'
);
