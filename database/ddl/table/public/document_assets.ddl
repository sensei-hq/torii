-- database/ddl/table/public/document_assets.ddl
set search_path to public, extensions;

create table if not exists document_assets (
  tenant_id    uuid not null
, id           uuid not null default gen_random_uuid()
, document_id  uuid not null
, kind         varchar(20) not null
    check (kind in ('markdown', 'table_csv', 'image', 'json', 'text', 'other'))
, storage_path varchar(1000)
, label        varchar(255)
, sequence     integer
, metadata     jsonb
, created_at   timestamptz not null default now()
, primary key (tenant_id, id)
, foreign key (tenant_id, document_id)
    references documents(tenant_id, id) on delete cascade
);

create index if not exists idx_document_assets_doc on document_assets(tenant_id, document_id);

comment on table document_assets is
'Extracted artifacts from a document — markdown, table CSVs, images, json (the
markdown-first ingestion outputs). Access inherits the parent document
(policies/knowledge.sql); composite FK keeps assets in-tenant.';

-- C5 RAG (2026-08-01): version link, hash-addressing, and evidence-pin provenance (page_ref/bbox)
-- + broadened artifact kinds (original / ir_json / caption). One row per artifact.
alter table document_assets add column if not exists version_id   uuid;
alter table document_assets add column if not exists content_hash char(64);
alter table document_assets add column if not exists page_ref     integer;
alter table document_assets add column if not exists bbox         jsonb;
alter table document_assets add column if not exists caption      text;
alter table document_assets drop constraint if exists document_assets_kind_check;
alter table document_assets add constraint document_assets_kind_check check (kind in (
  'original','ir_json','markdown','table_csv','image','caption','json','text','other'));
