-- database/ddl/view/governance/feature_governance_for_tenant.ddl
set search_path to governance, core, extensions;

-- §D §B shield view (Phase 4): the per-tenant feature catalog + resolved WORKSPACE-scope policy
-- state. Backs GET /v1/governance, judge.rs::judge_enabled, and the config snapshot's features
-- block. Absorbs the feature_key→feature_id fold on the READ side: exposes the human `slug` (the
-- stable API/frontend key) while feature_policies stores the uuid FK — so readers never touch the
-- fold. One row per (tenant, feature): the global governance.features catalog × the tenant, with
-- the workspace policy (if any) resolved via a scalar subquery. Gateway-internal: read via the
-- service_role pool, tenant-filtered; NOT granted to authenticated (all-tenant rows, no
-- security_invoker → a grant would be a PostgREST cross-tenant leak).
create or replace view feature_governance_for_tenant as
select
  t.id        as tenant_id
, f.id        as feature_id
, f.slug
, f.title
, f.description
, f.purpose
, f.enabled
, f.mandatory
, f.sequence
, f.module_id
  -- resolved WORKSPACE-scope policy state (null = no workspace policy → catalog default applies).
, ( select p.state
      from governance.feature_policies p
     where p.tenant_id  = t.id
       and p.feature_id  = f.id
       and p.scope_type  = 'workspace'
       and p.scope_id is null
     order by p.modified_at desc
     limit 1 ) as policy_state
from core.tenants t
cross join governance.features f;

comment on view feature_governance_for_tenant is
'Feature governance read shield (§D §B, Phase 4): governance.features × core.tenants with the
resolved workspace feature_policies state. Exposes slug (stable API key) over the feature_id fold.
Backs /v1/governance, judge_enabled, and the config snapshot. Gateway-internal; never grant to
authenticated.';
