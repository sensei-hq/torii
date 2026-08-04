-- database/ddl/table/public/service_accounts.ddl
set search_path to public, core, extensions;

-- RW4 (decision #2): a first-class programmatic identity. It IS a node in the
-- org/budget tree (budget_nodes.kind='service'); spend meters to that node.
create table if not exists service_accounts (
  tenant_id      uuid        not null references core.tenants(id) on delete cascade
, id             uuid        not null default gen_random_uuid()
, name           varchar(200) not null
, budget_node_id uuid                                    -- its leaf in the budget tree
, status         core.service_account_status not null default 'active'
, created_by     varchar     not null default 'system'
, created_at     timestamptz not null default now()
, primary key (tenant_id, id)
);

comment on table service_accounts is
'RW4: programmatic identity; a node in the org/budget tree (kind=service). Budget
binds to this identity, never to a key (DECISIONS §2 W2). Service_role-write.';
