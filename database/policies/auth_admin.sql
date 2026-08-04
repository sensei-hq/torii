-- RLS · auth-admin read access for the access-token hook
-- custom_access_token_hook runs as supabase_auth_admin (does NOT bypass RLS), so
-- it needs explicit read access to the tables it consults during token issuance.
-- RW2: it now reads memberships (active membership) + profile_roles (role_ids)
-- + profiles (claims_version). The group-ACL (profile_groups) is retired (RW9).

grant usage on schema core to supabase_auth_admin;
grant select on core.memberships, core.profile_roles, core.profiles
  to supabase_auth_admin;

do $$
declare r record;
begin
  for r in select * from (values
    ('core', 'memberships'),
    ('core', 'profile_roles'),
    ('core', 'profiles')
  ) as x(sch, tbl)
  loop
    execute format('alter table %I.%I enable row level security', r.sch, r.tbl);
    execute format('drop policy if exists %I on %I.%I', r.tbl || '_auth_admin', r.sch, r.tbl);
    execute format(
      'create policy %I on %I.%I for select to supabase_auth_admin using (true)',
      r.tbl || '_auth_admin', r.sch, r.tbl
    );
  end loop;
end $$;
