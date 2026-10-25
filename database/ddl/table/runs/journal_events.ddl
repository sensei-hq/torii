-- database/ddl/table/runs/journal_events.ddl
set search_path to runs, core, extensions;
-- TM-6 (torii#24): the append-only execution journal. `seq` is one global identity, so events
-- of a run replay in insert order; it is unique on its own, the tenant_id lead is for RLS + index
-- locality.
create table if not exists journal_events (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, seq         bigint      not null generated always as identity
, run_id      uuid        not null
, event       jsonb       not null
, created_at  timestamptz not null default now()
, primary key (tenant_id, seq)
);
create index if not exists idx_journal_events_run_seq on journal_events(tenant_id, run_id, seq);
comment on table journal_events is 'TM-6: append-only per-run execution journal (serde JournalEvent). Service_role-write.';
