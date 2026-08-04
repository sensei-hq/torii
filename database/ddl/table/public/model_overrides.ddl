-- database/ddl/table/public/model_overrides.ddl
set search_path to public, core, config, catalog, extensions;
-- RW10: per-tenant/space/role model enablement + pricing overrides over config.models.
create table if not exists model_overrides (
  tenant_id     uuid        not null references core.tenants(id) on delete cascade
, id            uuid        not null default gen_random_uuid()
, model_id      uuid        not null references config.models(id) on delete cascade
, scope_type    catalog.override_scope not null default 'tenant'
, scope_id      uuid
, enabled       boolean     not null default true
, price_input   numeric(12,6)
, price_output  numeric(12,6)
, verified      boolean     not null default false
, modified_at   timestamptz not null default now()
, modified_by   varchar     not null default 'system'
, primary key (tenant_id, id)
, unique (tenant_id, model_id, scope_type, scope_id)
);
comment on table model_overrides is 'RW10: per-tenant/space/role model enable + pricing overrides. Service_role-write.';
