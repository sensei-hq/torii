-- database/ddl/table/core/permissions.ddl
set search_path to core, extensions;

-- §D core rename: capabilities → permissions (name-only; stays in core — ends the
-- core.capabilities vs config.capabilities collision, db-redesign.md §68/§242). Closed reference
-- enumeration of grantable capabilities (F2 §4.3). role_permissions.capability FKs here (the
-- `capability` column name is kept), so every grant is a valid capability.
create table if not exists permissions (
  key          varchar  primary key   -- '<domain>.<verb>' e.g. 'budget.write'
, domain       varchar  not null
, description  varchar  not null
);

comment on table permissions is
'Closed capability set (F2 §4.3), seeded from staging (renamed from core.capabilities).
role_permissions.capability references this table, so an ungrantable capability cannot be
stored. Naming is <domain>.<verb>; reads use .read (audit.read, analytics.read).';
