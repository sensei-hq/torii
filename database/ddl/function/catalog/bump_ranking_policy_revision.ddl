-- database/ddl/function/catalog/bump_ranking_policy_revision.ddl
set search_path to catalog, extensions;

-- A ranking policy's `revision` is the resolver's proof that an ordering was derived
-- from the margin in force at the time, and it is part of the snapshot cache key. A
-- plain `update … set margin = …` would leave it stale and let a cached snapshot
-- outlive the change it should have invalidated, so the bump is a trigger rather than
-- a convention an editor has to remember.
--
-- Only a real change bumps it: a no-op update (or one that only touches modified_by)
-- returns NEW untouched.
create or replace function catalog.bump_ranking_policy_revision()
returns trigger
language plpgsql
as $$
begin
  if new.margin is not distinct from old.margin
     and new.category is not distinct from old.category
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;

  new.revision    := old.revision + 1;
  new.modified_at := now();

  return new;
end;
$$;

create or replace trigger bump_ranking_policy_revision_trigger
  before update on catalog.ranking_policies
  for each row execute function catalog.bump_ranking_policy_revision();

comment on function catalog.bump_ranking_policy_revision() is
'Bumps catalog.ranking_policies.revision (and modified_at) when the policy itself
changes, so the resolver cache key and the recorded call provenance track edits.';
