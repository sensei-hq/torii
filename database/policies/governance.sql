-- RLS · governance & ops (audit_events, devices)
-- settings uses the SELECT-only privileged policy (tenant_isolation.sql).

-- audit_events: append-only for clients — SELECT + INSERT within tenant, never
-- UPDATE/DELETE. RW8: INSERT binds actor_id = auth.uid() so a client CANNOT forge
-- another user's actor. service_role (the gateway) may write system events freely.
alter table audit.audit_events enable row level security;
drop policy if exists audit_events_select on audit.audit_events;
create policy audit_events_select on audit.audit_events for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
drop policy if exists audit_events_insert on audit.audit_events;
create policy audit_events_insert on audit.audit_events for insert to authenticated
  with check (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and actor_id = auth.uid()            -- RW8: no forged attribution
  );
revoke all on audit.audit_events from anon, authenticated, public;
grant select, insert on audit.audit_events to authenticated;
grant select, insert, update, delete on audit.audit_events to service_role;

-- devices: a user sees own devices; device.manage capability sees all in-tenant.
-- RW2: resolve via core.has_capability (the `role` JWT claim is gone).
alter table public.devices enable row level security;
-- O3-4: converge away a stale tenant-wide `devices_read` policy (created by an earlier
-- rework.sql privileged-read batch that once listed `devices`; dropped from that list but
-- left orphaned in data-bearing DBs). A permissive `devices_read` OR-s with devices_access
-- and defeats own-vs-manage, leaking every in-tenant device to a plain member. Drop it so
-- devices_access is the sole SELECT policy.
drop policy if exists devices_read on public.devices;
drop policy if exists devices_access on public.devices;
create policy devices_access on public.devices for select to authenticated
  using (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and (profile_id = auth.uid() or core.has_capability('device.manage'))
  );
revoke all on public.devices from anon, authenticated, public;
grant select on public.devices to authenticated;
grant select, insert, update, delete on public.devices to service_role;
