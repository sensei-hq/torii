-- database/ddl/table/public/budget_requests.ddl
set search_path to public, core, governance, extensions;

-- RW7: member budget-increase request → admin approval → applies to budget_nodes.cap.
-- The ONLY budget write a client may make directly: INSERT of an own pending request
-- (RLS below). Approve/reject is a service_role gateway action (budget.write).
create table if not exists budget_requests (
  tenant_id      uuid          not null references core.tenants(id) on delete cascade
, id             uuid          not null default gen_random_uuid()
, node_id        uuid          not null
, requested_by   uuid          not null            -- auth.uid() of the requester
, requested_cap  numeric(12,2) not null
, reason         text
, status         governance.request_status not null default 'pending'
, resolved_by    uuid
, resolved_at    timestamptz
, created_at     timestamptz   not null default now()
, primary key (tenant_id, id)
, foreign key (tenant_id, node_id) references budget_nodes(tenant_id, id) on delete cascade
);

create index if not exists idx_budget_requests_node on budget_requests(tenant_id, node_id, status);

comment on table budget_requests is
'RW7: member cap-increase requests. Client may INSERT an own pending row (RLS);
approve/reject/apply-to-cap is a service_role gateway action (budget.write).';
