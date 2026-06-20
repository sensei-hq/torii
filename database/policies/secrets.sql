-- RLS · secret tables (provider key vault)
-- RLS enabled with NO policy for anon/authenticated → fully denied to clients.
-- Only service_role (bypassrls) — i.e. the central gateway — can read/write.
-- F1.3 (secrets lockdown) verifies this and adds the negative tests.

alter table public.router_keys enable row level security;
alter table core.tenant_keys  enable row level security;
