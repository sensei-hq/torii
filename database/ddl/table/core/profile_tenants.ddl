-- database/ddl/table/core/profile_tenants.ddl
set search_path to core, extensions;

create table if not exists profile_tenants (
  profile_id   uuid        primary key
, tenant_id    uuid        not null references tenants(id) on delete restrict
, role         text        not null default 'member'
    check (role in ('owner', 'admin', 'editor', 'viewer', 'member', 'service'))
, assigned_at  timestamptz not null default now()
, assigned_by  varchar     not null
);

create index if not exists idx_profile_tenants_tenant
  on profile_tenants(tenant_id);

comment on table profile_tenants is
'Maps user profiles to their tenant. One row per profile (a profile belongs to
exactly one tenant).
- profile_id: Supabase auth.users.id
- assigned_by: ''domain_trigger'' when set automatically, or user/service account
- role: tenant-level RBAC (owner/admin/editor/viewer/member/service); injected into the JWT by custom_access_token_hook
- ON DELETE RESTRICT on tenant_id: cannot delete a tenant that has assigned users';
