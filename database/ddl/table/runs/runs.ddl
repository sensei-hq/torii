-- database/ddl/table/runs/runs.ddl
set search_path to runs, core, extensions;
-- TM-6 (torii#24): one row per run, stamped with the journal format it was written in, so a
-- worker refuses to resume a run whose journal it cannot read.
create table if not exists runs (
  tenant_id       uuid        not null references core.tenants(id) on delete cascade
, run_id          uuid        not null
, format_version  integer     not null
, created_at      timestamptz not null default now()
, primary key (tenant_id, run_id)
);
comment on table runs is 'TM-6: run registry + journal format_version fence. Service_role-write.';
