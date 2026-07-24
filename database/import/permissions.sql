-- Per-table write grants for REST API access.
-- Schema-level USAGE + broad SELECT/ALL grants are declared in design.yaml
-- and applied via `dbd grants` — this file covers only specific write overrides.

-- RW6 (DECISIONS §2 apply-without-asking): the anon-writable feature_states hole
-- is CLOSED. Feature governance is now the 4-state feature_policies table
-- (service_role-write) + user_preferences (owner self-write). Legacy
-- config.feature_states is locked to service_role only.
REVOKE INSERT, UPDATE, DELETE ON config.feature_states FROM anon, authenticated;
