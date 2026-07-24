-- database/ddl/table/public/user_preferences.ddl
set search_path to public, core, extensions;
-- RW6: the user layer of the workspace→space→role→user control model. Owner self-write.
create table if not exists user_preferences (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, profile_id  uuid        not null
, key         varchar(80) not null
, value       jsonb       not null default '{}'
, modified_at timestamptz not null default now()
, primary key (tenant_id, profile_id, key)
);
comment on table user_preferences is 'RW6: per-user preferences (theme, default model/tier, citation density, …); owner self-write RLS.';
