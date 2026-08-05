-- RLS · secret tables (provider key vault — keyvault schema, §D Phase 2)
-- RLS enabled with NO policy for anon/authenticated → fully denied to clients.
-- Only service_role (bypassrls) — i.e. the central gateway — can read/write.
-- F1.3 hardens this with explicit REVOKEs and confines access to service_role.

alter table keyvault.router_credentials enable row level security;
alter table keyvault.tenant_keys         enable row level security;
alter table keyvault.tenant_key_archive  enable row level security;  -- V4: superseded DEKs

-- Strip ALL privileges from client roles (defense in depth — removes the residual
-- TRIGGER/REFERENCES/TRUNCATE that Supabase default privileges grant on public tables).
revoke all on keyvault.router_credentials from anon, authenticated, public;
revoke all on keyvault.tenant_keys         from anon, authenticated, public;
revoke all on keyvault.tenant_key_archive  from anon, authenticated, public;

-- The central gateway (service_role) is the only reader/writer of key material. The keyvault
-- schema is deny-all: service_role needs USAGE to reach the tables (no client role gets it).
grant usage on schema keyvault to service_role;
grant select, insert, update, delete on keyvault.router_credentials to service_role;
grant select, insert, update, delete on keyvault.tenant_keys         to service_role;
grant select, insert, update, delete on keyvault.tenant_key_archive  to service_role;
