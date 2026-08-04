-- database/ddl/table/catalog/capability_types.ddl
set search_path to catalog, extensions;

-- §D rename+move: config.capabilities → catalog.capability_types (db-redesign.md §89/§242) — the
-- model-capability lookup, moved into the catalog domain + renamed to end the config.capabilities vs
-- (former) core.capabilities collision. Referenced by model_capabilities/model_endpoints/fallback_chains
-- via capability_id (FK column names kept). Global reference data (no tenant_id, no RLS).
create table if not exists capability_types (
  id                       uuid primary key default uuid_generate_v4()
, name                     varchar not null
, description              text
, category                 varchar
, parameters               jsonb
, modified_at              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists capability_types_ukey on capability_types(name);
create index if not exists capability_types_idx1 on capability_types(category);

comment on table capability_types IS
'Model capability definitions (renamed from config.capabilities).
- Centralized registry of capabilities (text_generation, image_generation, etc.)
- Used for model capability mapping and fallback chain configuration';
