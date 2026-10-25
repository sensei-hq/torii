-- database/ddl/procedure/staging/import_model_rankings.ddl
set search_path to staging;

-- Seed catalog.model_rankings from a decision-bench `ranking.json` (exported as
-- staging JSONL). Idempotent, and never overwrites a hand-edit:
--
--   1. rows the new artifact no longer carries (inside a category the artifact
--      still names) are removed, unless edited_by is set;
--   2. retained rows whose artifact_sha changed are updated and their revision
--      bumped; unchanged rows are left exactly as they are;
--   3. a row with edited_by set is reported in a NOTICE and left alone — clear
--      edited_by to accept the new artifact.
create or replace procedure import_model_rankings()
language plpgsql
as
$$
declare
  v_edited integer;
begin
  -- 1. Stale rows: the artifact covers the category, but no longer ranks this
  --    model (a dropped model, or a winner/tie that lost all its rows).
  delete from catalog.model_rankings r
   where r.edited_by is null
     and exists (select 1
                   from staging.model_ranking_artifacts a
                  where a.category = r.category)
     and not exists (select 1
                       from staging.model_rankings s
                       join catalog.models m
                         on m.full_name = lower(trim(s.model_full_name))
                      where trim(s.category) = r.category
                        and m.id              = r.model_id);

  -- 2. Hand-edits the artifact would change: report, never touch.
  select count(*)
    into v_edited
    from catalog.model_rankings r
    join catalog.models m
      on m.id = r.model_id
    join staging.model_rankings s
      on trim(s.category)        = r.category
     and lower(trim(s.model_full_name)) = m.full_name
   where r.edited_by       is not null
     and r.artifact_sha is distinct from s.artifact_sha;
  if v_edited > 0 then
    raise notice
      'model_rankings: % hand-edited row(s) left unchanged; clear edited_by to accept the new artifact',
      v_edited;
  end if;

  -- 3. Insert, or update a retained row when the artifact changed it.
  insert into catalog.model_rankings(
     category, model_id, rank, accuracy, ci_lo, ci_hi, ece, confident_wrong
   , coverage, p50_ms, verdict, evidence, proxy
   , corpus_sha, artifact_sha, generated_at, revision, edited_by
   , modified_at, modified_by)
  select trim(s.category)
       , m.id
       , s.rank
       , s.accuracy
       , s.ci_lo
       , s.ci_hi
       , s.ece
       , s.confident_wrong
       , s.coverage
       , s.p50_ms
       , s.verdict::catalog.verdict
       , array(select jsonb_array_elements_text(s.evidence))
       , s.proxy
       , s.corpus_sha
       , s.artifact_sha
       , s.generated_at
       , 1
       , null
       , coalesce(s.modified_at, now())
       , coalesce(s.modified_by, current_user)
    from staging.model_rankings s
   inner join catalog.models m
      on m.full_name = lower(trim(s.model_full_name))
  on conflict (category, model_id)
  do update
        set rank            = excluded.rank
          , accuracy        = excluded.accuracy
          , ci_lo           = excluded.ci_lo
          , ci_hi           = excluded.ci_hi
          , ece             = excluded.ece
          , confident_wrong = excluded.confident_wrong
          , coverage        = excluded.coverage
          , p50_ms          = excluded.p50_ms
          , verdict         = excluded.verdict
          , evidence        = excluded.evidence
          , proxy           = excluded.proxy
          , corpus_sha      = excluded.corpus_sha
          , artifact_sha    = excluded.artifact_sha
          , generated_at    = excluded.generated_at
          , revision        = case
                                when catalog.model_rankings.artifact_sha
                                     is distinct from excluded.artifact_sha
                                then catalog.model_rankings.revision + 1
                                else catalog.model_rankings.revision
                              end
          , modified_at     = excluded.modified_at
          , modified_by     = excluded.modified_by
        where catalog.model_rankings.edited_by is null
          and catalog.model_rankings.artifact_sha
              is distinct from excluded.artifact_sha;
end;
$$;
