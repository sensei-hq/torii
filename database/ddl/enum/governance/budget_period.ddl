-- database/ddl/enum/governance/budget_period.ddl
set search_path to governance;
-- db-redesign.md §3 governance→budget enum: the cap reset window for budget_nodes.period.
-- Reads flow through json_agg (text label); bound-&str writes need $N::governance.budget_period.
create type budget_period as enum ('daily', 'weekly', 'monthly');
