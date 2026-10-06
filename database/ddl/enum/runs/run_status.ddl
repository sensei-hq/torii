-- database/ddl/enum/runs/run_status.ddl
set search_path to runs;
-- TM-6 (torii#24): runs.scheduled_runs.status — the durable scheduler's lifecycle. 'waking' is a
-- claimed (leased) row being driven; 'paused' waits on next_wake or a force-wake; the other three
-- are terminal. Mirrors the gateway's orchestrator-core RunStatus.
create type run_status as enum ('waking', 'paused', 'completed', 'failed', 'cancelled');
