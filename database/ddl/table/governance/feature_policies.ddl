-- database/ddl/table/governance/feature_policies.ddl
set search_path to governance, core, extensions;
-- RW6 (DECISIONS §4): 4-state feature governance, precedence workspace→space→role→user.
-- §D Phase 4: feature_key(varchar) folded to feature_id(uuid FK→governance.features) for referential
-- integrity — a typo can no longer create a policy for a non-existent feature. The API/frontend stay
-- slug-based; writers resolve slug→feature_id, and the feature_governance_for_tenant shield exposes
-- slug on read.
create table if not exists feature_policies (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, id           uuid        not null default gen_random_uuid()
, feature_id   uuid        not null references governance.features(id) on delete cascade
, scope_type   governance.feature_scope not null
, scope_id     uuid                                    -- null for workspace; space/role id otherwise
, state        governance.feature_state not null
, modified_by  varchar     not null default 'system'
, modified_at  timestamptz not null default now()
, primary key (tenant_id, id)
, unique (tenant_id, feature_id, scope_type, scope_id)
);
comment on table feature_policies is 'RW6: 4-state governance (locked/default-on/default-off/user-overridable) per feature×scope; resolved workspace→space→role→user. feature_id FK→governance.features (§D Phase 4 fold). Service_role-write.';
