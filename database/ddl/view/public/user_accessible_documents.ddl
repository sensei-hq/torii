-- database/ddl/view/public/user_accessible_documents.ddl
set search_path to public, extensions;

create or replace view user_accessible_documents as
with recursive group_ancestors as (
  -- seed: user's direct memberships
  select tenant_id, profile_id, group_id
  from profile_groups

  union all

  -- walk up: add parent groups, staying within the same tenant
  select ga.tenant_id, ga.profile_id, ag.parent_id
  from group_ancestors ga
  join access_groups ag
    on ag.tenant_id = ga.tenant_id   -- explicit tenant guard prevents cross-tenant walk
   and ag.id        = ga.group_id
  where ag.parent_id is not null
)
select distinct
  ga.tenant_id
  , ga.profile_id
  , da.document_id
from group_ancestors ga
join document_access da
  on da.tenant_id = ga.tenant_id
 and da.group_id  = ga.group_id;

comment on view user_accessible_documents is
'Recursive CTE view — produces (tenant_id, profile_id, document_id) access set
by walking the group tree upward from the user''s direct memberships.
- Explicit tenant_id guard at every join prevents cross-tenant data leakage
- Callers must filter by both tenant_id and profile_id';
