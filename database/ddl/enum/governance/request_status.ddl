-- database/ddl/enum/governance/request_status.ddl
set search_path to governance;
-- db-redesign.md §3 governance→budget enum: budget_requests.status (budget-increase requests).
-- pending (on insert) → approved / denied (admin RPCs) ; withdrawn reserved for a requester
-- self-withdraw. Uses 'denied' — the live deny-RPC + audit + API vocabulary — NOT the old
-- CHECK's dead 'rejected' (nothing read/wrote it; budget_requests was empty at conversion).
create type request_status as enum ('pending', 'approved', 'denied', 'withdrawn');
