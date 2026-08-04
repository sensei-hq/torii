-- database/ddl/type/core/execution_location.ddl
set search_path to core;

-- db-redesign.md §3 shared enum. Unifies the four `execution_location` columns
-- (inference_calls / messages / gateway_tasks / analytics_usage_daily) AND routing
-- `plane` (fallback_chain_models.plane) onto one type — killing the plane/location split.
--
-- Value ADDITIONS flow through dbd reconcile (pre-release) / snapshot-migrate (post-
-- release), never a plain re-apply, so the referencing TABLES never churn on a value-add.
--
-- Rust write sites MUST cast (`$N::core.execution_location`): Postgres rejects a bound
-- text parameter straight into an enum column. Reads are unaffected — they flow through
-- json_agg/json_build_object, which serialize an enum to its text label. See tests/enums.sql.
create type execution_location as enum ('local', 'cloud');
