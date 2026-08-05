-- Per-table write grants for REST API access.
-- Schema-level USAGE + broad SELECT/ALL grants are declared in design.yaml
-- and applied via `dbd grants` — this file covers only specific write overrides.

-- RW6 (DECISIONS §2 apply-without-asking): feature governance is the 4-state
-- governance.feature_policies table (service_role-write, tenant-read RLS via rework.sql).
-- §D Phase 4: legacy config.feature_states was RETIRED (per-user feature state, unused) — its
-- service_role-only REVOKE is gone with the table. No specific write overrides remain here.
