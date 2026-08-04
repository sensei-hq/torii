-- database/ddl/table/public/budget_holds.ddl
set search_path to public, core, governance, extensions;

-- RW7 (DECISIONS §2 W2): the hard-reserve ledger. The gateway takes a row-locked
-- reserve on a node path before a call (available = cap - spent - reserved at every
-- ancestor), commits the actual cost on completion, or releases on failure. Makes
-- hard caps un-exceedable under concurrency. C3 §3.1 owns the shape.
create table if not exists budget_holds (
  tenant_id       uuid         not null references core.tenants(id) on delete cascade
, id              uuid         not null default gen_random_uuid()
, budget_node_id  uuid         not null            -- the leaf node the caller maps to
, path_node_ids   uuid[]       not null            -- every ancestor (incl. leaf) held
, amount          numeric(12,6) not null           -- estimated reserve (worst-case tokens)
, status          governance.hold_status not null default 'active'
, idempotency_key text                             -- dedupes retried reserves
, created_at      timestamptz  not null default now()
, expires_at      timestamptz  not null            -- TTL reaper releases stale holds
, primary key (tenant_id, id)
, foreign key (tenant_id, budget_node_id)
    references budget_nodes(tenant_id, id) on delete cascade
);

create index if not exists idx_budget_holds_node   on budget_holds(tenant_id, budget_node_id, status);
create index if not exists idx_budget_holds_expiry on budget_holds(status, expires_at);
create unique index if not exists budget_holds_idem_ukey
  on budget_holds(tenant_id, idempotency_key) where idempotency_key is not null;

comment on table budget_holds is
'RW7 hard-reserve ledger (service_role-only). A reserve holds `amount` against
every node in path_node_ids; committed→actual cost, released/expired→freed. The
headroom check (cap - spent - reserved) at each ancestor makes hard caps
concurrency-safe (DECISIONS §2 W2). Never client-written.';
