-- database/ddl/enum/metering/call_status.ddl
set search_path to metering;

-- db-redesign.md §3 metering enum: the inference-call outcome. Backs
-- metering.inference_calls.status (and the future compute_jobs.status, §7-#8).
-- gateway_tasks.status is NOT this enum — that table is legacy/retiring (§7) with a
-- distinct {running,success,failed} lifecycle set.
--
-- Reads that decode to a Rust String need ::text (get_inference_calls_by_session);
-- reads via json_agg serialize the label directly. Bound-&str writes need
-- $N::metering.call_status. Value additions flow through dbd reconcile. See tests/enums.sql.
create type call_status as enum ('success', 'failed');
