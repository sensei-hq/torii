-- RLS · governance & ops (audit_events, devices)
-- settings uses the generic tenant policy (see tenant_isolation.sql).

-- audit_events: append-only for clients — SELECT + INSERT within tenant, never
-- UPDATE/DELETE. service_role performs retention. revoke first to strip Supabase
-- default privileges (TRIGGER/REFERENCES/TRUNCATE/UPDATE/DELETE).
alter table public.audit_events enable row level security;
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events for insert to authenticated
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
revoke all on public.audit_events from anon, authenticated, public;
grant select, insert on public.audit_events to authenticated;
grant select, insert, update, delete on public.audit_events to service_role;

-- devices: a user sees own devices; owner/admin see all tenant devices.
alter table public.devices enable row level security;
drop policy if exists devices_access on public.devices;
create policy devices_access on public.devices for select to authenticated
  using (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and (profile_id = auth.uid() or (auth.jwt() ->> 'role') in ('owner', 'admin'))
  );
revoke all on public.devices from anon, authenticated, public;
grant select on public.devices to authenticated;
grant select, insert, update, delete on public.devices to service_role;
