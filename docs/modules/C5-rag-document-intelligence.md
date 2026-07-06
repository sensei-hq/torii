# C5 · RAG & document intelligence

**Plane:** Central · **Status:** Planned · **Depends on:** C1, F1, Supabase Storage

## Purpose

Turn documents into grounded, cited answers — and manage the knowledge base beyond plain retrieval. This is the product's "ask your documents" core.

## Responsibilities

- Ingest and normalize documents, chunk, embed, retrieve, and manage the resulting knowledge base + artifacts.

## What we build

- **Ingestion (markdown-first):** parse DOCX/PDF/PPTX/XLSX into **prose (markdown), tables (markdown + CSV), images/figures (files + captions)** — layout-aware (docling/marker/unstructured-class). OCR fallback. Per-doc status (queued→parsing→chunking→embedding→ready/failed).
- **Chunking strategies** (space-level): recursive/structural, paragraph, sentence-window, semantic, proposition, parent-document, late-chunking.
- **Retrieval (default):** **contextual retrieval + hybrid (dense+BM25) → cross-encoder rerank** → grounded generation with citations. **Advanced modes** (per space): RAPTOR, GraphRAG, ColBERT late-interaction, SQL-RAG (text-to-SQL over extracted tables), agentic RAG.
- **Document management:** collections/folders/tags, versions, lineage (source→artifacts), dedup, bulk actions; **cloud tenant storage** of artifacts (md + images + CSV) in Supabase Storage, scoped by tenant/space/access-group.
- **Retrieval inspector** data (chunks, scores, reranked/dropped) for W3.

## Key contracts / data

- `documents`, `document_embeddings` (pgvector, F1); ingestion job + artifact records; retrieval request/response with citations.

## UI surfaces

- Library/document workspace (W2), Playground/retrieval lab (W3), Spaces & KB admin (W1/O3).

## Reuse / source

`strategos_old` `vector`/`rag` packages; `gateway-embedded` fastembed for local embeddings; gap analysis §3.

## Open questions

- Parser choice; embedding model (local fastembed vs cloud); which advanced modes ship in v1.
