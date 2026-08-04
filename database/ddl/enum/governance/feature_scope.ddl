-- database/ddl/enum/governance/feature_scope.ddl
set search_path to governance;
-- db-redesign.md §3 governance enum: feature_policies.scope_type (governance precedence layer,
-- workspace→space→role). Bound-&str writes (set/clear-feature RPCs) cast $N::governance.feature_scope;
-- reads are json_agg/comparisons. resolve_feature_state compares via literals (coerce).
create type feature_scope as enum ('workspace', 'space', 'role');
