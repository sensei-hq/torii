-- database/ddl/table/public/analytics_usage_daily.ddl
set search_path to public, core, extensions;
-- RW15 (O2): daily usage rollup (reconstructable cache; not a parallel ledger).
create table if not exists analytics_usage_daily (
  tenant_id     uuid        not null references core.tenants(id) on delete cascade
, day           date        not null
, model         text        not null default ''
, plane         varchar(10) not null default 'cloud'
, requests      bigint      not null default 0
, input_tokens  bigint      not null default 0
, output_tokens bigint      not null default 0
, cost_usd      numeric(14,6) not null default 0
, primary key (tenant_id, day, model, plane)
);
comment on table analytics_usage_daily is 'RW15 (O2): daily usage/cost rollup over inference_calls; reconcilable. Service_role-write.';
