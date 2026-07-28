set search_path to staging;

-- Staging for the SHARED default system roles → core.roles (tenant_id NULL). Custom roles are
-- created at runtime per tenant, never seeded.
create table if not exists roles (
  key        varchar not null
, name       varchar not null
, is_system  boolean default true
);

create unique index if not exists roles_ukey on roles(key);
