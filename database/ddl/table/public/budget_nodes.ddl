-- database/ddl/table/public/budget_nodes.ddl
set search_path to public, core, extensions;

create table if not exists budget_nodes (
  tenant_id          uuid not null
    references core.tenants(id) on delete cascade
, id                 uuid not null default gen_random_uuid()
, parent_id          uuid
, kind               varchar(20) not null
    check (kind in ('org', 'dept', 'team', 'user', 'service'))
, name               varchar(200) not null
, ref_id             uuid          -- entity this node maps to (e.g. user kind → profile_id)
, cap_amount         numeric(12,2)
, period             varchar(10) not null default 'monthly'
    check (period in ('daily', 'weekly', 'monthly'))
, enforcement        varchar(10) not null default 'hard'
    check (enforcement in ('hard', 'soft'))
, alert_threshold    numeric(4,3)  -- fraction 0..1 (e.g. 0.800 = alert at 80%)
    check (alert_threshold is null or (alert_threshold >= 0 and alert_threshold <= 1))
, free_floor_enabled boolean not null default true
, spent_amount       numeric(12,2) not null default 0
, currency           varchar(3) not null default 'USD'
, created_at         timestamptz not null default now()
, modified_at        timestamptz not null default now()
, modified_by        varchar not null
, primary key (tenant_id, id)
, foreign key (tenant_id, parent_id)
    references budget_nodes(tenant_id, id) on delete cascade
);

create index if not exists idx_budget_nodes_parent on budget_nodes(tenant_id, parent_id);
create index if not exists idx_budget_nodes_kind   on budget_nodes(tenant_id, kind);
create index if not exists idx_budget_nodes_ref    on budget_nodes(tenant_id, ref_id);

comment on table budget_nodes is
'Cascading spend budgets: a self-referential tree org → dept → team → user/service.
- parent_id: composite self-FK (tenant_id, parent_id) keeps the tree in-tenant.
- cap_amount + period (daily/weekly/monthly): the cap and its reset window.
- enforcement hard|soft; alert_threshold (fraction); free_floor_enabled: drop to a
  free local model when exhausted.
- spent_amount: rollup maintained by C3 (budgets & metering); ref_id links a node to
  the profile/team it represents.
- A call is allowed only if every ancestor node (user→team→dept→org) has headroom.';
