-- database/ddl/enum/content/document_lifecycle.ddl
set search_path to content;
-- db-redesign.md §7-#5 SPLIT: documents.status{10 transient+terminal values} → this STABLE
-- lifecycle enum + a free-form `documents.stage varchar` for the transient pipeline step
-- (parsing/redacting/chunking/embedding/indexing), so pipeline changes never churn the enum.
-- Map: uploaded/queued→pending; parsing/…/indexing→processing (step in `stage`); completed;
-- failed; archived (new). hybrid_search/similarity_search filter lifecycle='completed'.
create type document_lifecycle as enum ('pending', 'processing', 'completed', 'failed', 'archived');
