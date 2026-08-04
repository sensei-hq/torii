-- database/ddl/enum/governance/hold_status.ddl
set search_path to governance;
-- db-redesign.md §3 governance→budget enum: budget_holds.status lifecycle. Written by the
-- C3 PL/pgSQL fns budget_reserve('active') → budget_commit('committed') / budget_release
-- ('released'); 'expired' for lapsed holds. Those fns compare/assign via literals (coerce).
create type hold_status as enum ('active', 'committed', 'released', 'expired');
