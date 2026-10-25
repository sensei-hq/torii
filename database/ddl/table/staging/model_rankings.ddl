set search_path to staging;

-- Import mirror of catalog.model_rankings. JSONL rows are keyed by the model's
-- natural name (full_name), like every other import file; the procedure resolves
-- the uuid. `evidence` is jsonb here (the JSONL shape) and becomes text[] in the
-- catalog table.
create table if not exists model_rankings (
  category         text   not null
, model_full_name  varchar not null
, rank             integer
, accuracy         numeric
, ci_lo            numeric
, ci_hi            numeric
, ece              numeric
, confident_wrong  numeric
, coverage         numeric
, p50_ms           integer
, verdict          text   not null
, evidence         jsonb  not null default '[]'
, proxy            text
, corpus_sha       text
, artifact_sha     text
, generated_at     timestamp with time zone
, modified_at      timestamp with time zone default now()
, modified_by      varchar default current_user
);

create unique index if not exists model_rankings_ukey
    on model_rankings(category, model_full_name);
