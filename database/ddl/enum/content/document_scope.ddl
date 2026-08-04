-- database/ddl/enum/content/document_scope.ddl
set search_path to content;
-- db-redesign.md §3 content→knowledge enum: documents.scope (visibility tier). Bound write in
-- rag/store.rs register_document → $6::content.document_scope; read via json_build_object (no cast).
-- The uncalled similarity_search helper's `d.scope = any(scope_filter text[])` gets d.scope::text.
create type document_scope as enum ('system', 'tenant', 'user');
