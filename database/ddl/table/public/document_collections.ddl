-- database/ddl/table/public/document_collections.ddl
set search_path to public, core, extensions;

create table if not exists document_collections (
  tenant_id   uuid not null
    references core.tenants(id) on delete cascade
, id          uuid not null default gen_random_uuid()
, space_id    uuid
, parent_id   uuid
, name        varchar(200) not null
, description text
, created_at  timestamptz not null default now()
, modified_at timestamptz not null default now()
, modified_by varchar not null
, primary key (tenant_id, id)
, foreign key (tenant_id, space_id)
    references spaces(tenant_id, id) on delete cascade
, foreign key (tenant_id, parent_id)
    references document_collections(tenant_id, id) on delete cascade
);

create index if not exists idx_document_collections_space  on document_collections(tenant_id, space_id);
create index if not exists idx_document_collections_parent on document_collections(tenant_id, parent_id);

comment on table document_collections is
'Folders/collections within a space (hierarchical via parent_id) — organizational
grouping for documents (documents.collection_id). Tenant-scoped RLS.';
