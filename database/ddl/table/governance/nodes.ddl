-- database/ddl/table/governance/nodes.ddl
set search_path to governance, core, extensions;

-- §D Phase 5 (org/budget split): the budget cap facet, split OUT of the old public.budget_nodes.
-- Structure (parent_id/kind/name/ref_id) moved to core.org_units; this table keeps only the cap.
-- `org_unit_id` FK→core.org_units anchors the cap to a unit in the ONE org tree — no parallel budget
-- hierarchy; the tree walked by budget_reserve/analytics comes from org_units.parent_id.
--
-- DC-1 (id == org_unit_id, enforced by CHECK + UNIQUE): the node IS the budget facet of its unit
-- (strict 1:1). This keeps node-id and unit-id interchangeable so the C1 hot-path reserve contract is
-- preserved (resolve_node still returns one id → chat.rs/judge.rs untouched), budget_holds.budget_node_id
-- + budget_requests.node_id keep pointing at nodes, and the ledger's budget_node_id/*_node_id values
-- (which store budget-node ids today) stay valid as org_unit ids — so the split needs NO ledger data
-- migration and P6's inference_calls.org_unit_id rename is trivial. `node_kind` enum DROPPED (the
-- unit's tree level is the kind, derived via core.unit_kind).
create table if not exists nodes (
  tenant_id          uuid not null
    references core.tenants(id) on delete cascade
, id                 uuid not null default gen_random_uuid()
, org_unit_id        uuid not null          -- the unit this cap attaches to; == id (DC-1)
, cap_amount         numeric(14,6)  -- micro-dollar precision: per-call costs are sub-cent
, period             governance.budget_period not null default 'monthly'
, enforcement        governance.enforcement   not null default 'hard'
, alert_threshold    numeric(4,3)  -- fraction 0..1 (e.g. 0.800 = alert at 80%)
    check (alert_threshold is null or (alert_threshold >= 0 and alert_threshold <= 1))
, free_floor_enabled boolean not null default true
, spent_amount       numeric(14,6) not null default 0  -- micro-dollar precision (see cap_amount)
, reserved_amount    numeric(14,6) not null default 0  -- RW7 hard-reserve
, period_started_at  timestamptz   not null default now()
, soft_overshoot_limit numeric(14,6)
, currency           varchar(3) not null default 'USD'
, created_at         timestamptz not null default now()
, modified_at        timestamptz not null default now()
, modified_by        varchar not null
, primary key (tenant_id, id)
, foreign key (tenant_id, org_unit_id)
    references core.org_units(tenant_id, id) on delete cascade
, constraint nodes_org_unit_unique unique (tenant_id, org_unit_id)
, constraint nodes_id_is_unit check (id = org_unit_id)
);

comment on table nodes is
'Cascading spend budgets (§D Phase 5, was public.budget_nodes). The CAP facet only — structure lives
in core.org_units. org_unit_id FK→core.org_units anchors the cap; id == org_unit_id (DC-1, 1:1) so the
node is the budget facet of its unit. A call is allowed only if EVERY ancestor unit that has a hard cap
has headroom (cap - spent - reserved); the ancestor walk is over core.org_units.parent_id
(budget_reserve). RW7 hard-reserve cols (reserved_amount, period_started_at, soft_overshoot_limit).
Service_role-write, tenant SELECT-only.';
