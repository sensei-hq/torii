-- apps/admin/e2e/fixtures/runs.teardown.sql
--
-- Removes exactly what runs.seed.sql wrote, by run id — the dev tenant keeps whatever else it
-- had. Applied before the seed (so a crashed run re-seeds cleanly) and again after the spec, so
-- a walk through the Runs screens does not leave 62 fake runs behind in the dev UI.
--
-- The run_id predicates are the whole contract: `c000000%` is the six rich runs and
-- `d0000000-%` the filler page, and no real run id (a random uuid) matches either.
\set ON_ERROR_STOP on

-- Calls first: execution_traces cascades from them. `inference_calls.run_id` carries no FK by
-- design (accounting history must not be cascade-deleted with a run), so this is explicit.
delete from metering.inference_calls
 where run_id::text like 'c000000%' or run_id::text like 'd0000000-%';
delete from runs.run_charges
 where run_id::text like 'c000000%' or run_id::text like 'd0000000-%';
delete from runs.scheduled_runs
 where run_id::text like 'c000000%' or run_id::text like 'd0000000-%';
delete from runs.runs
 where run_id::text like 'c000000%' or run_id::text like 'd0000000-%';
