-- database/ddl/table/config/model_capabilities.ddl
set search_path to config, extensions;

create table if not exists model_capabilities (
  id                       uuid primary key default uuid_generate_v4()
, model_id                 uuid not null references models(id)
, capability_id            uuid not null references catalog.capability_types(id)
, capability_details       jsonb
, performance_metrics      jsonb
, limitations              jsonb
, supported                boolean not null default true
, verified_at              timestamp with time zone
, verified_by              varchar(50)
, modified_at              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists model_capabilities_ukey on model_capabilities(model_id, capability_id);
create index if not exists model_capabilities_fkey1 on model_capabilities(model_id);
create index if not exists model_capabilities_fkey2 on model_capabilities(capability_id);
create index if not exists model_capabilities_idx1 on model_capabilities(supported);
create index if not exists model_capabilities_idx2 on model_capabilities(verified_at);

comment on table model_capabilities IS
'Model-capability mappings with performance data and capability learning.
- Moved from public to config schema — reference data, not tenant-specific
- Maps AI models to their supported capabilities
- supported/verified_at/verified_by enable capability learning from API failures
- When an adapter throws CapabilityNotSupportedError, supported is set to false';
