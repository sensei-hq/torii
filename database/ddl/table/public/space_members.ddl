-- database/ddl/table/public/space_members.ddl
set search_path to public, core, extensions;

create table if not exists space_members (
  tenant_id   uuid not null
, space_id    uuid not null
, profile_id  uuid not null
, role        varchar(20) not null default 'member'
    check (role in ('owner', 'editor', 'viewer', 'member'))
, added_at    timestamptz not null default now()
, primary key (tenant_id, space_id, profile_id)
, foreign key (tenant_id, space_id)
    references spaces(tenant_id, id) on delete cascade
);

create index if not exists idx_space_members_space   on space_members(tenant_id, space_id);
create index if not exists idx_space_members_profile on space_members(tenant_id, profile_id);

comment on table space_members is
'User ↔ space membership within a tenant.
- Composite FK to spaces(tenant_id, id) keeps membership in-tenant.
- role: in-space role (informational for now; document RLS uses membership, not role).
- Confidential documents in a space are readable only by its members (see policies/knowledge.sql).';
