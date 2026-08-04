-- database/ddl/table/public/document_assets.ddl
set search_path to public, extensions;

create table if not exists document_assets (
  tenant_id    uuid not null
, id           uuid not null default gen_random_uuid()
, document_id  uuid not null
, kind         varchar(20) not null
    check (kind in ('original','ir_json','markdown','table_csv','image','caption','json','text','other'))
, storage_path varchar(1000)
, label        varchar(255)
, sequence     integer
, metadata     jsonb
, created_at   timestamptz not null default now()
  -- C5 RAG: version link, hash-addressing, and evidence-pin provenance (page_ref/bbox).
, version_id   uuid
, content_hash char(64)
, page_ref     integer
, bbox         jsonb
, caption      text
, primary key (tenant_id, id)
, foreign key (tenant_id, document_id)
    references documents(tenant_id, id) on delete cascade
);

create index if not exists idx_document_assets_doc on document_assets(tenant_id, document_id);

comment on table document_assets is
'Extracted artifacts from a document — markdown, table CSVs, images, json (the
markdown-first ingestion outputs). Access inherits the parent document
(policies/knowledge.sql); composite FK keeps assets in-tenant.';
