-- database/ddl/table/core/capabilities.ddl
set search_path to core, extensions;

-- RW2: closed reference enumeration of grantable capabilities (F2 §4.3).
-- role_permissions.capability FKs here, so every grant is a valid capability.
create table if not exists capabilities (
  key          varchar  primary key   -- '<domain>.<verb>' e.g. 'budget.write'
, domain       varchar  not null
, description  varchar  not null
);

comment on table capabilities is
'Closed capability set (F2 §4.3), seeded from staging. role_permissions.capability
references this table, so an ungrantable capability cannot be stored. Naming is
<domain>.<verb>; reads use .read (audit.read, analytics.read).';
