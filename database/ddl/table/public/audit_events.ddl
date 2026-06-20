-- database/ddl/table/public/audit_events.ddl
set search_path to public, core, extensions;

create table if not exists audit_events (
  tenant_id    uuid not null
    references core.tenants(id) on delete cascade
, id           uuid not null default gen_random_uuid()
, actor_id     uuid                       -- profile that acted (null = system/service)
, action       varchar(100) not null      -- e.g. config.updated, document.exported, signin
, target_type  varchar(50)                -- e.g. router_key, document, budget_node
, target_id    uuid
, data         jsonb not null default '{}'
, ip_address   inet
, created_at   timestamptz not null default now()
, primary key (tenant_id, id)
);

create index if not exists idx_audit_events_created on audit_events(tenant_id, created_at desc);
create index if not exists idx_audit_events_action  on audit_events(tenant_id, action);

comment on table audit_events is
'Append-only audit ledger. Clients may INSERT + SELECT within their tenant — no
UPDATE/DELETE (enforced by grants + RLS in policies/governance.sql). service_role
handles retention; O1 streams events to SIEM.';
