set search_path to runs, core, extensions;

-- AG-13 (torii#49, decision C5 #41): which budget nodes an agent run is charged to, and how much
-- of its spend has been recorded on them. At submit torii derives the run's money limit from the
-- ISSUER's caps (individual, group, org-unit hierarchy — the tightest headroom wins) and the engine
-- enforces it; the run's actual spend, folded from its journal, is then added to every node in
-- `node_ids` (governance.nodes.spent_amount), so Budgets & billing shows one number for questions
-- and runs.
--
-- `recorded_micro_usd` is the idempotency watermark: a settle adds only `journal spend − recorded`
-- and moves the watermark in the same transaction, under a row lock, so a re-drive or a repeated
-- settle never double-counts. `seen_updated_at` is the `scheduled_runs.updated_at` the last settle
-- read before folding the journal — a run whose schedule row has not moved since has no new spend
-- to record. `settled` is set once a terminal run's final spend is recorded.
--
-- `issuer_profile_id` deliberately has no FK: this row is accounting history and must not block
-- (or be cascaded away by) a profile's removal.
create table if not exists run_charges (
  tenant_id           uuid        not null references core.tenants(id) on delete cascade
, run_id              uuid        not null
, issuer_profile_id   uuid        not null
, node_ids            uuid[]      not null            -- governance.nodes ids (== org_unit ids, DC-1)
, limit_micro_usd     bigint      not null            -- the money limit admitted at submit
, recorded_micro_usd  bigint      not null default 0  -- spend already added to node_ids
, seen_updated_at     timestamptz
, settled             boolean     not null default false
, created_at          timestamptz not null default now()
, primary key (tenant_id, run_id)
);

create index if not exists idx_run_charges_unsettled on run_charges(tenant_id) where not settled;

comment on table run_charges is
'AG-13: an agent run''s budget charge — the issuer, the budget nodes (governance.nodes) its spend is
recorded on, the limit admitted at submit, and the recorded-spend watermark that makes recording
idempotent. Service_role-write.';
