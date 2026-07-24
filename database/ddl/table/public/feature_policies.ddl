-- database/ddl/table/public/feature_policies.ddl
set search_path to public, core, extensions;
-- RW6 (DECISIONS §4): 4-state feature governance, precedence workspace→space→role→user.
create table if not exists feature_policies (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, id           uuid        not null default gen_random_uuid()
, feature_key  varchar(120) not null
, scope_type   varchar(12) not null check (scope_type in ('workspace','space','role'))
, scope_id     uuid                                    -- null for workspace; space/role id otherwise
, state        varchar(20) not null
    check (state in ('locked','default-on','default-off','user-overridable'))
, modified_by  varchar     not null default 'system'
, modified_at  timestamptz not null default now()
, primary key (tenant_id, id)
, unique (tenant_id, feature_key, scope_type, scope_id)
);
comment on table feature_policies is 'RW6: 4-state governance (locked/default-on/default-off/user-overridable) per feature×scope; resolved workspace→space→role→user. Service_role-write.';
