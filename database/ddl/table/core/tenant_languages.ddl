-- database/ddl/table/core/tenant_languages.ddl
set search_path to core, extensions;

create table if not exists tenant_languages (
  tenant_id   uuid    not null references tenants(id) on delete cascade
, language    varchar not null
, is_default  boolean not null default false
, is_active   boolean not null default true
, modified_at timestamptz not null default now()
, modified_by varchar     not null
, primary key (tenant_id, language)
);

create unique index if not exists tenant_languages_default_ukey
  on tenant_languages(tenant_id)
  where is_default = true;

comment on table tenant_languages is
'Languages supported by each tenant.
- is_default: exactly one default per tenant (enforced by partial unique index)
- is_active: hides language from UI without deleting
- Application reads _lang table for active language first; falls back to base table value';
