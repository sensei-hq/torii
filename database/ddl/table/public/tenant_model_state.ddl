-- database/ddl/table/public/tenant_model_state.ddl
set search_path to public, core, extensions;

-- W1: per-(tenant, model) enablement for the Models editor. An ABSENT row means the
-- model is enabled (the default); a row with enabled=false disables that model for the
-- tenant. Gateway-mediated: read via /v1/models, written via /rpc/models/set-enabled.
create table if not exists tenant_model_state (
  tenant_id       uuid         not null references core.tenants(id) on delete cascade
, model_full_name varchar(160) not null
, enabled         boolean      not null default true
, modified_by     varchar      not null default 'system'
, modified_at     timestamptz  not null default now()
, primary key (tenant_id, model_full_name)
);

alter table tenant_model_state enable row level security;
-- Own-tenant SELECT (policy in policies/rework.sql); writes go through the gateway's
-- service_role connection (RLS-bypassing) — clients never write this table directly.

comment on table tenant_model_state is
'W1: per-(tenant, model) enablement override. Absent row = enabled. Service_role-write,
own-tenant SELECT via RLS. Read through /v1/models, written via /rpc/models/set-enabled.';
