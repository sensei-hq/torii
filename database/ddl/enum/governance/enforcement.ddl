-- database/ddl/enum/governance/enforcement.ddl
set search_path to governance;
-- db-redesign.md §3 governance→budget enum: budget_nodes.enforcement. 'hard' = the C3
-- synchronous reserve blocks over-cap spend (budget_reserve fn); 'soft' = alert-only.
-- Reads flow through json_agg; bound-&str writes need $N::governance.enforcement.
create type enforcement as enum ('hard', 'soft');
