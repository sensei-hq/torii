-- database/ddl/table/core/unit_members.ddl
set search_path to core, extensions;

-- §D Phase 5 (org/budget split): people → org units. Replaces budget_nodes.ref_id for user
-- attribution (the C1 hot path + analytics own-subtree resolve a caller's personal unit through
-- here). Phase 5 seeds PERSONAL units only (from the old kind='user' nodes: ref_id→profile→their
-- personal unit); dept/team membership lands with the SCIM/directory-sync fast-follow (decision #3).
create table if not exists unit_members (
  tenant_id  uuid not null references tenants(id) on delete cascade
, unit_id    uuid not null
, profile_id uuid not null references profiles(id) on delete cascade
, created_at timestamptz not null default now()
, added_by   varchar     not null default 'system'
, primary key (tenant_id, unit_id, profile_id)
, foreign key (tenant_id, unit_id) references org_units(tenant_id, id) on delete cascade
);

create index if not exists idx_unit_members_profile on unit_members(tenant_id, profile_id);

comment on table unit_members is
'§D Phase 5: people→units mapping (replaces budget_nodes.ref_id). Phase 5 seeds personal units only;
dept/team via the SCIM fast-follow (decision #3). Service_role-write, tenant SELECT-only.';
