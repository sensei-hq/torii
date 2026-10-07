-- database/ddl/table/runs/scheduled_runs.ddl
set search_path to runs, core, extensions;
-- TM-6 (torii#24): the durable scheduler's queue. `graph` is the ORIGINAL submitted graph;
-- next_wake NULL = no timer (needs a force-wake); claimed_at is the lease stamp on 'waking' rows
-- for crash-reclaim; reason is the last pause/fail reason.
-- AG-3 (torii#53): attempts counts CONSECUTIVE wake attempts since the last successful drive
-- (enqueue = 1, record_paused resets to 0, begin_wake_attempt adds one); last_wake_error is the
-- error the latest failed attempt recorded, taken (cleared) by the next begin_wake_attempt. On a
-- 'waking' row next_wake is the armed retry deadline, so a lost drive is reclaimed only past
-- both its lease and its backoff.
create table if not exists scheduled_runs (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, run_id      uuid        not null
, graph       jsonb       not null
, status      run_status  not null
, next_wake   timestamptz
, claimed_at  timestamptz
, reason      text
, attempts    integer     not null default 0
, last_wake_error text
, updated_at  timestamptz not null default now()
, primary key (tenant_id, run_id)
);
create index if not exists idx_scheduled_runs_due on scheduled_runs(tenant_id, status, next_wake);
comment on table scheduled_runs is 'TM-6: durable run schedule (status/next_wake/lease). Service_role-write.';
