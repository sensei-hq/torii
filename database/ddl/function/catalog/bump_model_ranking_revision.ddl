-- database/ddl/function/catalog/bump_model_ranking_revision.ddl
set search_path to catalog, extensions;

-- A ranking row's `revision` is the same kind of proof its policy's is: the resolver
-- carries it in the call trace and in the snapshot cache key, so a row that changed
-- without a bump would let a cached ordering outlive the measurement behind it.
--
-- Who changes a row: the seeder (`import_model_rankings`, on conflict do update) and,
-- from the admin, a human edit. Both are real changes and both must bump, so this is a
-- trigger rather than something each writer remembers. The seeder's own guard — it
-- skips rows whose `modified_at` is newer than the staging row — is about not
-- overwriting a hand-edit; it is not a revision rule.
--
-- Only a real change bumps: a re-run of the same artifact writes identical values and
-- leaves `revision` alone (verified: two consecutive imports leave every row at its
-- starting revision). `edited_by` is compared too, so attributing an edit is itself a
-- change — the resolver's snapshot must not keep serving an order whose provenance
-- reads as unedited.
create or replace function catalog.bump_model_ranking_revision()
returns trigger
language plpgsql
as $$
begin
  if new.rank            is not distinct from old.rank
     and new.accuracy        is not distinct from old.accuracy
     and new.ci_lo           is not distinct from old.ci_lo
     and new.ci_hi           is not distinct from old.ci_hi
     and new.ece             is not distinct from old.ece
     and new.confident_wrong is not distinct from old.confident_wrong
     and new.coverage        is not distinct from old.coverage
     and new.p50_ms          is not distinct from old.p50_ms
     and new.verdict         is not distinct from old.verdict
     and new.evidence        is not distinct from old.evidence
     and new.proxy           is not distinct from old.proxy
     and new.corpus_sha      is not distinct from old.corpus_sha
     and new.artifact_sha    is not distinct from old.artifact_sha
     and new.generated_at    is not distinct from old.generated_at
     and new.edited_by       is not distinct from old.edited_by then
    return new;
  end if;

  new.revision    := old.revision + 1;
  new.modified_at := now();

  return new;
end;
$$;

-- Model rows are keyed (category, model_id); an update never moves them, but the
-- trigger is declared here so it travels with the table DDL rather than with a seeder.
create or replace trigger bump_model_ranking_revision_trigger
  before update on catalog.model_rankings
  for each row execute function catalog.bump_model_ranking_revision();

comment on function catalog.bump_model_ranking_revision() is
'Bumps catalog.model_rankings.revision (and modified_at) when a measured value, the
verdict, the provenance or the edit attribution changes — so a cached ordering cannot
outlive the measurement it was derived from. A re-run of the same artifact does not bump.';
