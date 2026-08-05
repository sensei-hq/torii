-- database/ddl/table/core/unit_levels.ddl
set search_path to core, extensions;

-- §D Phase 5 (org/budget split): per-tenant labels for the org-tree tiers. `level` is the tier
-- ordinal shared with core.org_units (0=Organization … 4=Service, seeded default); companies relabel
-- their hierarchy here without changing the machine tier. NOTE the budget tree's `kind` derives from
-- the ordinal via core.unit_kind (a FIXED map), NOT from this label — this row is purely the
-- human-facing name shown on the Organization screen.
create table if not exists unit_levels (
  tenant_id   uuid    not null references tenants(id) on delete cascade
, level       int     not null
, label       varchar(100) not null
, created_at  timestamptz not null default now()
, modified_at timestamptz not null default now()
, modified_by varchar     not null default 'system'
, primary key (tenant_id, level)
);

comment on table unit_levels is
'§D Phase 5: per-tenant org-tree tier labels (level ordinal → label). Seeded default 0=Organization,
1=Department, 2=Team, 3=Personal, 4=Service. Relabel-only config; the budget `kind` derives from the
ordinal (core.unit_kind), not this label. Service_role-write, tenant SELECT-only.';
