-- database/ddl/table/public/analytics_quality_daily.ddl
set search_path to public, core, extensions;
-- RW15 (O2): daily quality-signal rollup.
create table if not exists analytics_quality_daily (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, day         date        not null
, signal_key  varchar(60) not null
, samples     bigint      not null default 0
, avg_value   numeric(12,6)
, primary key (tenant_id, day, signal_key)
);
comment on table analytics_quality_daily is 'RW15 (O2): daily quality-signal rollup over quality_signals. Service_role-write.';
