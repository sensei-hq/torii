-- database/ddl/table/core/org_units.ddl
set search_path to core, extensions;

-- §D Phase 5 (org/budget split): the ONE configurable org tree. Split OUT of the old budget_nodes
-- (its structure half). `parent_id` is the composite in-tenant self-FK tree (arbitrary depth);
-- `level` is the tier ordinal (→ unit_levels; 0=org … 4=service) — a TIER LABEL, NOT tree depth: a
-- service (4) or personal (3) unit may hang off a team (2), so there is deliberately no level==depth
-- CHECK. This single tree scopes content (spaces, later) AND anchors budget (governance.nodes
-- attaches its cap to a unit here, 1:1, via org_unit_id). `org_unit_kind` enum DROPPED — level is the kind.
create table if not exists org_units (
  tenant_id   uuid    not null references tenants(id) on delete cascade
, id          uuid    not null default gen_random_uuid()
, parent_id   uuid                                        -- composite self-FK below; NULL = tenant org root
, level       int     not null                            -- tier ordinal → unit_levels (0=org…4=service)
, name        varchar(200) not null
, is_personal boolean not null default false              -- true only for a user's personal unit (level 3)
, created_at  timestamptz not null default now()
, modified_at timestamptz not null default now()
, modified_by varchar     not null default 'system'
, primary key (tenant_id, id)
, foreign key (tenant_id, parent_id) references org_units(tenant_id, id) on delete cascade
, foreign key (tenant_id, level)     references unit_levels(tenant_id, level)
);

create index if not exists idx_org_units_parent on org_units(tenant_id, parent_id);
create index if not exists idx_org_units_level  on org_units(tenant_id, level);

comment on table org_units is
'§D Phase 5: the ONE configurable org tree (arbitrary depth via parent_id, per-tenant labels via
unit_levels). Split out of budget_nodes structure. level = tier ordinal (0=org…4=service), a tier
label NOT tree depth. Scopes content + anchors budget (governance.nodes.org_unit_id, 1:1, with
nodes.id == org_unit_id — see governance.nodes). Service_role-write, tenant SELECT-only.';
