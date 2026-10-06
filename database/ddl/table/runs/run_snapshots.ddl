-- database/ddl/table/runs/run_snapshots.ddl
set search_path to runs, core, extensions;
-- TM-6 (torii#24): the latest folded state of a run at journal position `seq`, so resume replays
-- only the tail.
create table if not exists run_snapshots (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, run_id      uuid        not null
, seq         bigint      not null
, snapshot    jsonb       not null
, updated_at  timestamptz not null default now()
, primary key (tenant_id, run_id)
);
comment on table run_snapshots is 'TM-6: latest run snapshot + the journal seq it folds through. Service_role-write.';
