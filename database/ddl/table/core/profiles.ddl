-- database/ddl/table/core/profiles.ddl
set search_path to core, extensions;

-- RW2: per-user identity anchor. One row per Supabase auth user.
create table if not exists profiles (
  id             uuid        primary key  -- = auth.users.id (auth.uid())
, display_name   varchar
, avatar_url     varchar
, claims_version bigint      not null default 0
, created_at     timestamptz not null default now()
, modified_at    timestamptz not null default now()
);

comment on table profiles is
'Per-user identity anchor (id = auth.users.id). claims_version is a monotonic
counter bumped whenever the user''s role assignments / active tenant change; the
custom_access_token_hook stamps it into every JWT and C1''s DeviceGuard rejects a
token whose claims_version is stale — the downgrade-revocation gate (DECISIONS §2).';

comment on column profiles.claims_version is
'Monotonic token-freshness counter (i64/bigint everywhere). Bumped on role
assign/unassign and active-tenant change; NOT on role_permissions edits (those
re-resolve server-side without forcing re-auth).';
