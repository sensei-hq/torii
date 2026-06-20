-- Per-table write grants for REST API access.
-- Schema-level USAGE + broad SELECT/ALL grants are declared in design.yaml
-- and applied via `dbd grants` — this file covers only specific write overrides.

-- These tables are writable via REST API by authenticated users.
GRANT INSERT, UPDATE, DELETE ON config.feature_states TO anon, authenticated;
