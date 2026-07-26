-- Dev demo for the O3 device-fleet screen: three enrolled devices for the seeded
-- owner (owner2). status='revoked' cuts a device on the auth hot path. Idempotent.

insert into public.devices
  (id, tenant_id, profile_id, name, platform, public_key, app_version, config_version, status, enrolled_at, last_seen_at)
values
  ('d0d10000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   '5107174b-8e10-40c7-a279-7f466c7ccf77', 'aiko-mbp', 'macOS 15 · M3 Pro',
   'ed25519:9f2a-c41d', '0.4.2', 412, 'active', now() - interval '30 days', now()),
  ('d0d10000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   '5107174b-8e10-40c7-a279-7f466c7ccf77', 'leasing-win', 'Windows 11 · RTX',
   'ed25519:3b7e-88a0', '0.4.2', 412, 'active', now() - interval '20 days', now() - interval '3 minutes'),
  ('d0d10000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   '5107174b-8e10-40c7-a279-7f466c7ccf77', 'ops-runner', 'Linux · headless',
   'ed25519:1a0f-d52c', '0.4.1', 408, 'active', now() - interval '10 days', now() - interval '1 hour')
on conflict (tenant_id, id) do nothing;
