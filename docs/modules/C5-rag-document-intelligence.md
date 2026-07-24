# C5 · RAG & document intelligence

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Central · **Status:** Planned · **Depends on:** C1, F1, F3 (field-level encryption, §3c), Supabase Storage · redaction/DLP via C4 (§2 W5)

> A research-backed design — [`../design/rag-and-document-center.md`](../design/rag-and-document-center.md) — is forthcoming (DECISIONS §3a, authored in step 4): current best-practice hybrid/graph/vector retrieval, chunking, reranking, evaluation, contextual retrieval, plus the document-center and sensitive-structured-data surfaces. This seed states scope only.

## Purpose

Turn documents into grounded, cited answers — and manage the knowledge base beyond plain retrieval. This is the product's "ask your documents" core.

## Responsibilities

- Ingest and normalize documents, chunk, embed, retrieve, and manage the resulting knowledge base + artifacts — the markdown-first **document center** (§3a).
- **Redact secrets/PII at rest** during ingestion (§2 W5) and compute over **sensitive structured data without exposing values** (§3c).
- Emit a **quality/audit signal** (§3b) for every redaction and every sensitive-data computation.

## What we build

- **Ingestion (markdown-first):** parse DOCX/PDF/PPTX/XLSX/images into **prose (markdown), tables (markdown + CSV), images/figures (files + captions)** — layout-aware (docling/marker/unstructured-class). OCR fallback. **Always keep and reference the original.** Per-doc status pipeline (queued→parsing→chunking→embedding→ready/failed).
- **Redact-at-rest (§2 W5):** during ingestion, detect + redact secrets/keys/tokens/PII in the normalized markdown **and before embedding**, so the vector store/index never holds raw secrets — store only placeholders; any reversible mapping lives in a `service_role`-only encrypted store (F1 redaction-mapping table). Use vetted high-recall secret scanners + PII classifiers, not hand-rolled regex. This is one of the three W5 enforcement points (with C1/C4 inference and X1 tool egress).
- **Chunking strategies** (space-level): recursive/structural, paragraph, sentence-window, semantic, proposition, parent-document, late-chunking.
- **Retrieval (composable per space, §3a).** Not one mode — **classic (BM25/keyword) + dense vector + hybrid fusion**, semantic/structure-aware chunking, **contextual retrieval**, **cross-encoder rerank** (a separate C5 rerank service, see Reuse/source), plus **GraphRAG** (entity/relation graph) and advanced modes (**RAPTOR**, **multi-vector/ColBERT**, **SQL-RAG/text-to-SQL** over extracted tables, **agentic** retrieve→reason→re-retrieve) selectable per space. **Default stack:** markdown-first parse → semantic/structural chunking → contextual retrieval + hybrid (dense+BM25) → cross-encoder rerank → grounded generation with citations. Admins/space-owners set defaults (feature-governed); member experiments are session-only.
- **Sensitive structured data — compute without exposing (§3c).** Ingest CSV/XLSX + tables extracted from docs as **queryable datasets** (JSON/CSV) with a **schema** (column names, types, descriptions, stats) and **column-level sensitivity** classification. Sensitive/restricted columns are **field-encrypted per tenant (F3 DEK)**, decryptable only inside the trusted compute boundary. The LLM receives only **schema + non-sensitive metadata/samples/aggregates** and emits a **computation plan** (text-to-SQL / filter / formula); the app/gateway **executes it in the trusted boundary** and returns only the derived, policy-gated result (aggregate-only / k-anonymity / min-group thresholds; result passes the W5 redaction check). Sensitive datasets can be **pinned to the local plane** so raw values never leave the device. v1 direction; builds on SQL-RAG.
- **Document center (§3a).** Tenant/space-scoped **object storage** (Supabase Storage / S3-style buckets) for originals + normalized artifacts (md + images + CSV); **dedup** (content hash + lineage source→artifacts); **versioning** (re-upload = new version, history kept); collections/folders/tags; bulk actions; preview (rendered md / table-as-grid / image gallery). **Ownership at org / space / individual** (`documents.scope` + `owner_id` + space), layered on the space+classification ACL. Storage is scoped by **tenant/space + classification** (the retired `access_groups`/`document_access` recursive ACL is **not** used — see §3). **Collaborative editing, comments, and corrections are v2 runtime (design-only screens in v1)** — users interact via chat and an **agent performs the edits** (aligns with X2 agents = design-only v1 / runtime v2).
- **Retrieval inspector** data (chunks, scores, reranked/dropped) for W3.

## Key contracts / data

- `documents`, `document_embeddings` (pgvector **`vector(1024)`** — F1 fix from 384, re-pointed to the space/classification ACL); `documents.content_hash` + lineage (dedup); object-storage refs on `document_assets` (originals + normalized md/CSV/images); per-space retrieval/chunking config on `spaces`/`settings`.
- **Structured datasets** (§3c): dataset + column-schema with per-column sensitivity + field-level encryption for sensitive columns (F1/F3).
- `service_role`-only **redaction-mapping store** (§2 W5, when reversible redaction is needed); **`quality_signals`** rows (§3b) for redactions and sensitive-data computes.
- Ingestion job + artifact records; retrieval request/response with citations; computation-plan request/response (§3c).

## UI surfaces

- Library/document workspace + document center (collections/versions/lineage/dedup, extracted-asset browser, ingestion-status, preview) (W2); Playground/retrieval lab — **per-space retrieval-mode selector + inspector** (W3); Spaces & KB admin (W1/O3). Design-only collaborative surfaces (comment threads, suggestion/correction review, chat-to-edit panel) ship as **screens in v1, runtime in v2**.

## Reuse / source

`strategos_old` `vector`/`rag` packages; **local embeddings via the engine's in-process `EmbeddedLlamaAdapter` (llama.cpp/GGUF) / `OrtAdapter`** (`sensei-local-engine` + `sensei-local-providers`) — **no daemon; the registry handles model pull** — **not** `fastembed` (a disabled placeholder in the crate); pick a **1024-dim** pullable model (e.g. `mxbai-embed-large` / `bge-large`) to match `document_embeddings vector(1024)`. Engine = the six `sensei-*` crates @ **`v0.4.6`** (no `gateway-embedded`). **Rerank = a separate C5 service** for v1 (the crate's `TextRerank` is a reserved `Unsupported` variant; a `RerankModel` trait is a later optional gateway issue). Gap analysis §3; DECISIONS §3a/§3c.

## Open questions

- Parser choice (docling / marker / unstructured-class) and OCR engine.
- Which advanced retrieval modes are exposed in the v1 selector vs. deferred (default stack is fixed; GraphRAG/RAPTOR/ColBERT/SQL-RAG/agentic are the candidate per-space options).
- Reversible vs. one-way redaction per detector class (drives whether the redaction-mapping store is populated).

*(Resolved by DECISIONS.md: markdown-first is the ingestion contract; local embeddings = in-process `EmbeddedLlamaAdapter` (llama.cpp/GGUF) / `OrtAdapter` at 1024-dim (no daemon; registry handles pull), not fastembed; robust composable retrieval + document center + sensitive-structured-data are all v1; agent-driven collaborative editing is v2. Detail lands in [`../design/rag-and-document-center.md`](../design/rag-and-document-center.md).)*
