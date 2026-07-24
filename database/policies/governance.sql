-- RLS · governance & ops (audit_events, devices)
-- settings uses the SELECT-only privileged policy (tenant_isolation.sql).

-- audit_events: append-only for clients — SELECT + INSERT within tenant, never
-- UPDATE/DELETE. RW8: INSERT binds actor_id = auth.uid() so a client CANNOT forge
-- another user's actor. service_role (the gateway) may write system events freely.
alter table public.audit_events enable row level security;
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events for insert to authenticated
  with check (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and actor_id = auth.uid()            -- RW8: no forged attribution
  );
revoke all on public.audit_events from anon, authenticated, public;
grant select, insert on public.audit_events to authenticated;
grant select, insert, update, delete on public.audit_events to service_role;

-- devices: a user sees own devices; device.manage capability sees all in-tenant.
-- RW2: resolve via core.has_capability (the `role` JWT claim is gone).
alter table public.devices enable row level security;
drop policy if exists devices_access on public.devices;
create policy devices_access on public.devices for select to authenticated
  using (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and (profile_id = auth.uid() or core.has_capability('device.manage'))
  );
revoke all on public.devices from anon, authenticated, public;
grant select on public.devices to authenticated;
grant select, insert, update, delete on public.devices to service_role;
