-- database/ddl/table/public/document_access.ddl
set search_path to public, extensions;

create table if not exists document_access (
  tenant_id   uuid not null
, document_id uuid not null
, group_id    uuid not null
, primary key (tenant_id, document_id, group_id)
, foreign key (tenant_id, document_id)
    references documents(tenant_id, id) on delete cascade
, foreign key (tenant_id, group_id)
    references access_groups(tenant_id, id) on delete cascade
);

create index if not exists idx_document_access_document
  on document_access(tenant_id, document_id);

create index if not exists idx_document_access_group
  on document_access(tenant_id, group_id);

comment on table document_access is
'Document ↔ group grants within a tenant.
- tenant_id: new column, partition key — prevents cross-tenant grants at FK level
- A row here means all members of this group (and ancestor groups) can read the document
- Both FKs are composite to enforce same-tenant constraint at the database level';
