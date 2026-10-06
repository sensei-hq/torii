-- database/ddl/table/runs/cas_blobs.ddl
set search_path to runs, core, extensions;
-- TM-6 (torii#24): content-addressed blobs (node outputs, context values). Per tenant, not shared:
-- a digest match across tenants must never let one tenant read another's bytes.
create table if not exists cas_blobs (
  tenant_id   uuid        not null references core.tenants(id) on delete cascade
, digest      text        not null
, bytes       bytea       not null
, created_at  timestamptz not null default now()
, primary key (tenant_id, digest)
);
comment on table cas_blobs is 'TM-6: per-tenant content-addressed blob store. Service_role-write.';
