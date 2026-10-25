-- database/ddl/table/catalog/model_rankings.ddl
set search_path to catalog, core, extensions;

-- The measured ranking store (§System One Phase 3). One current row per
-- (category, model), seeded from decision-bench's `ranking.json` and editable
-- afterwards. Platform-level reference data: a ranking is a measurement of a
-- model, not a tenant's choice, so there is no tenant_id and no RLS — the
-- resolver reads it through service_role, tenant-scoped by catalog.chains_for_tenant.
create table if not exists model_rankings (
  category        text        not null
, model_id        uuid        not null
    references catalog.models(id) on delete cascade
  -- 1 = best. NULL is the storage-level "a tie is not an order": only a
  -- `winner` verdict carries a rank, so no consumer can sort a tie by accident.
, rank            integer
, accuracy        numeric
, ci_lo           numeric
, ci_hi           numeric
, ece             numeric
, confident_wrong numeric
, coverage        numeric
, p50_ms          integer
, verdict         catalog.verdict not null
, evidence        text[]      not null default '{}'
  -- Set when the evidence is a stand-in ('tool.route' for 'planner.select').
, proxy           text
, corpus_sha      text
, artifact_sha    text
, generated_at    timestamptz
  -- Monotonic per (category, model): bumped whenever the artifact changes a row.
, revision        bigint      not null default 1
  -- Set by a human edit; the seeder leaves such a row alone (and warns).
, edited_by       text
, modified_at     timestamptz not null default now()
, modified_by     varchar     not null default current_user
, primary key (category, model_id)
  -- The rule the artifact states, enforced where the data lives: an order
  -- exists exactly for a winner.
, constraint model_rankings_order_check
    check ((verdict = 'winner') = (rank is not null))
, constraint model_rankings_rank_positive_check
    check (rank is null or rank > 0)
);

-- One rank per category; a tie leaves the column NULL, so many NULLs coexist.
create unique index if not exists model_rankings_order_ukey
  on model_rankings(category, rank)
  where rank is not null;

create index if not exists model_rankings_category_idx
  on model_rankings(category, rank);

create index if not exists model_rankings_corpus_idx
  on model_rankings(corpus_sha, artifact_sha);

comment on table model_rankings is
'The measured ranking store (System One Phase 3), seeded from decision-bench ranking.json.
- (category, model_id) is the current row; `revision` counts artifact changes
- `rank` is NULL unless `verdict = winner`: a tie is a set, not a sequence
- `evidence` names the benchmark scenarios behind the row; `proxy` names a stand-in
- `edited_by` marks a hand-edit the seeder must not overwrite
- Global reference data (no tenant_id, no RLS): read through service_role and joined to
  catalog.chains_for_tenant, which applies the tenant scope.';
