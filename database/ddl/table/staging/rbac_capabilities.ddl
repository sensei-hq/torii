set search_path to staging;

-- Staging for the RBAC capability catalog → core.permissions. Named `rbac_capabilities` to
-- avoid staging.capabilities (which imports MODEL capabilities → config.capabilities).
create table if not exists rbac_capabilities (
  key          varchar not null
, domain       varchar not null
, description  varchar not null
);

create unique index if not exists rbac_capabilities_ukey on rbac_capabilities(key);
