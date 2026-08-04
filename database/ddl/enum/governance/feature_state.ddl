-- database/ddl/enum/governance/feature_state.ddl
set search_path to governance;
-- db-redesign.md §3 governance enum: feature_policies.state (the RW6 4-state governance value).
-- judge.rs decodes this into a Rust String (C6 quality-judge gate) → that read casts state::text.
-- Bound writes cast $N::governance.feature_state; literals/comparisons coerce.
create type feature_state as enum ('locked', 'default-on', 'default-off', 'user-overridable');
