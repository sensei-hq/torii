-- Anchor a core.profiles row for every existing auth user.
--
-- WHY THIS EXISTS: `core.assign_tenant_by_domain()` creates the profile anchor, but it is an
-- INSERT trigger on auth.users — it fires once, when the user signs up. `dbd reset` drops the
-- project's own schemas (core, catalog, …) while Supabase's `auth` schema is NOT dbd-managed
-- and survives untouched. So after every reset the auth users are still there and their
-- profiles are gone, and nothing re-fires the trigger.
--
-- The symptom is not a missing login. Sign-in succeeds (Supabase owns that), the session is
-- valid, and the failure surfaces much later as a foreign-key error from the onboarding RPC:
--
--   orgs_create: seed tenant: insert or update on table "memberships"
--   violates foreign key constraint "memberships_profile_id_fkey"
--
-- Idempotent, and deliberately id-only — the same columns the trigger sets. Tenant assignment
-- is NOT replayed here: domain-matching is the trigger's job at signup, and re-running it on a
-- reset could silently re-home a user into a tenant they were since moved out of.
insert into core.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;
