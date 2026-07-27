-- RLS · secret tables (provider key vault)
-- RLS enabled with NO policy for anon/authenticated → fully denied to clients.
-- Only service_role (bypassrls) — i.e. the central gateway — can read/write.
-- F1.3 hardens this with explicit REVOKEs and confines access to service_role.

alter table public.router_credentials enable row level security;
alter table core.tenant_keys  enable row level security;

-- Strip ALL privileges from client roles (defense in depth — removes the residual
-- TRIGGER/REFERENCES/TRUNCATE that Supabase default privileges grant on public tables).
revoke all on public.router_credentials from anon, authenticated, public;
revoke all on core.tenant_keys  from anon, authenticated, public;

-- The central gateway (service_role) is the only reader/writer of key material.
grant usage on schema core to service_role;
grant select, insert, update, delete on public.router_credentials to service_role;
grant select, insert, update, delete on core.tenant_keys  to service_role;
