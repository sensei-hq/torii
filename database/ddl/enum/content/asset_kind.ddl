-- database/ddl/enum/content/asset_kind.ddl
set search_path to content;
-- db-redesign.md §3 content→knowledge enum: document_assets.kind (derived-artifact type). Bound
-- write in rag/store.rs insert_asset → $4::content.asset_kind; the assets-list route decodes kind
-- into a Rust String tuple → that SELECT casts kind::text.
create type asset_kind as enum ('original', 'ir_json', 'markdown', 'table_csv', 'image', 'caption', 'json', 'text', 'other');
