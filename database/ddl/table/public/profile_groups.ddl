-- database/ddl/table/public/profile_groups.ddl
set search_path to public, extensions;

create table if not exists profile_groups (
  tenant_id  uuid not null
, profile_id uuid not null
, group_id   uuid not null
, primary key (tenant_id, profile_id, group_id)
, foreign key (tenant_id, group_id)
    references access_groups(tenant_id, id) on delete cascade
) partition by list (tenant_id);

create index if not exists idx_profile_groups_profile
  on profile_groups(tenant_id, profile_id);

create index if not exists idx_profile_groups_group
  on profile_groups(tenant_id, group_id);

comment on table profile_groups is
'User ↔ group membership within a tenant.
- tenant_id: new column, partition key
- Composite FK to access_groups(tenant_id, id) prevents cross-tenant membership
- Downward inheritance (parent group grants) handled by user_accessible_documents view';
