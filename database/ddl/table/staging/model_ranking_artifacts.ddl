set search_path to staging;

-- One row per category in a ranking artifact: the header that makes the seed
-- authoritative for a category even when the category has no model rows
-- (unranked / insufficient). Without it, a category that drops to unranked in a
-- new artifact would leave its previous rows behind: no staging row would name
-- the category to clear.
create table if not exists model_ranking_artifacts (
  category         text    not null
, verdict          text    not null
, proxy            text
, evidence         jsonb   not null default '[]'
, shared_cases     integer not null default 0
, corpus_sha       text
, artifact_sha     text
, generated_at     timestamp with time zone
, modified_at      timestamp with time zone default now()
, modified_by      varchar default current_user
);

create unique index if not exists model_ranking_artifacts_ukey
    on model_ranking_artifacts(category);
