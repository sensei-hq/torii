-- RLS · auth-admin read access for the access-token hook
-- custom_access_token_hook runs as supabase_auth_admin (does NOT bypass RLS), so
-- it needs explicit read access to the tables it consults during token issuance.

grant usage on schema core, public to supabase_auth_admin;
grant select on core.profile_tenants, public.profile_groups to supabase_auth_admin;

alter table core.profile_tenants enable row level security;
drop policy if exists profile_tenants_auth_admin on core.profile_tenants;
create policy profile_tenants_auth_admin on core.profile_tenants
  for select to supabase_auth_admin using (true);

alter table public.profile_groups enable row level security;
drop policy if exists profile_groups_auth_admin on public.profile_groups;
create policy profile_groups_auth_admin on public.profile_groups
  for select to supabase_auth_admin using (true);
