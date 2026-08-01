# C5 · RAG backend vertical slice — build plan (frozen design)

**Status:** In progress · **Scope:** backend + tests only (frontend = follow-up run) · **Date:** 2026-08-01
**Spec:** [`../specs/C5-rag-document-intelligence.md`](../specs/C5-rag-document-intelligence.md) · **Decisions:** [`../DECISIONS.md`](../DECISIONS.md) §2 W5 / §3a/§3b/§3c
**Design basis:** [`../design/rag-and-document-center.md`](../design/rag-and-document-center.md)

Derived from a design workflow (3 independent architectures — pragmatic / spec-faithful / security-first —
synthesized into one frozen buildable design). This doc is the SoT for the build; the C5 spec remains the
contract.

## Ratified scope decisions (user)
- **Embed:** Ollama `mxbai-embed-large` (1024-dim), **config-driven** (no-hardcoded-ops). Preferred path =
  the engine's **embedded in-process** `EmbeddedLlamaAdapter` + `ModelResolver` (Ollama/HfHubPuller) — no
  external Ollama daemon (C5 §7.1). Tests use a **deterministic `StubEmbedder`** (hermetic, 1024-dim).
- **Ingest:** FULL — binary parsing (PDF/DOCX/XLSX/PPTX/HTML/image) + object storage (Supabase Storage,
  signed upload/download URLs) + `document_assets` (original + markdown + table CSV + image artifacts).
- **Breadth:** backend runtime + tests only this run.

## Non-negotiable security invariants
1. **Cross-tenant recall = 0** — a hard per-tenant filter lives *inside* `hybrid_search` (the gateway is
   `service_role` → RLS-bypassing → isolation must be in the query), and mirrors `policies/knowledge.sql`
   byte-for-byte (regression-gated).
2. **Redact-at-rest before embedding** — one-way placeholders only; the index (`document_embeddings.content`
   + generated `tsv`) never holds a raw secret. No reversible mapping store (v1).
3. **4-level classification** (public/internal→tenant member, confidential→space member, restricted→doc/space
   owner) enforced in `hybrid_search` + every read handler.
4. **No-hardcoded-ops** — chunk size/overlap, k_dense/k_bm25/k_out, rrf_k, match_threshold, embed model/chain
   all from per-space `settings` over fallback consts; changing config changes behaviour with no code change.
5. **Fail-closed** — missing config → deny; embed dim ≠ 1024 → error (ingest → `failed` + `status_reason`,
   never a corrupt vector).

## Key design decisions (conflict resolutions)
- **`tsv` = STORED generated column** `to_tsvector('english', coalesce(contextual_prefix,'')||' '||content)`
  → the BM25 leg cannot go stale (dual-write invariant holds structurally, zero write-code).
- **Terminal status stays `completed`** (not spec's `ready`); the CHECK is broadened with fine stages
  (`queued/parsing/redacting/chunking/embedding/indexing`) but `completed` remains the retrieval filter —
  keeps `similarity_search`, the W1/W2 admin screens, and `document_embeddings` in sync.
- **Keep column names** `content`/`chunk_sequence`; reuse `start_position`/`end_position` for char offsets.
- **`pgvector` crate is mandatory** (sqlx cannot bind `vector(1024)` otherwise).
- **`embed-local` Cargo feature (default OFF)** gates the llama.cpp/embedded path so the Fly Linux central
  build stays light; `EngineEmbedder` is identical whether embedding runs in-process or via a cloud/ollama
  chain.
- **One shared `zip`+`quick-xml` OOXML extractor** for DOCX *and* PPTX (drop `docx-rs`).
- **`current_version_id` is a plain uuid** (no FK — avoids a documents↔versions cyclic forward-ref; dbd rule).
- **Dedup = code-enforced lookup** + non-unique `content_hash` index (the same file may live in two spaces).

## DB delta (additive; applied via `dbd reconcile`, NOT reset — live DB is data-bearing)
Target: live Supabase stack `postgresql://postgres:postgres@127.0.0.1:55322/postgres` (`-e dev`). The 5432
`database/.env` default is a stale scratch DB — always pass `-d …55322…` explicitly.
1. `documents` — add `content_hash`, `current_version_id`, `status_reason`; broaden `status` CHECK (keep
   `completed`); add `idx_documents_content_hash`.
2. `document_versions` — add `content_hash`, `parser`, `parser_version`, `superseded_at` + hash index.
3. `document_assets` — add `version_id`, `content_hash`, `page_ref`, `bbox`, `caption`; broaden `kind` CHECK
   (`original`/`ir_json`/`caption`).
4. `document_embeddings` — add `version_id`, `parent_chunk_id`, `contextual_prefix`, `section_path`,
   `page_ref`, `element_type`, `redaction_count`, `superseded_at`; **STORED generated `tsv`** + GIN;
   version-scoped uniqueness `(tenant_id, document_id, version_id, chunk_sequence)`.
5. New `public.hybrid_search()` — dense pgvector cosine + BM25 (`websearch_to_tsquery`/`ts_rank_cd`) fused by
   RRF (k=60), classification+space+tenant predicate inline, excludes superseded, filters `status='completed'`.
   `language sql stable`; grants mirror `similarity_search`.

## Module tree (`services/gateway/src/rag/`) — frozen interfaces
`mod.rs` (RagError, consts, RetrievalConfig/ChunkConfig + resolvers) · `parse.rs` (DocumentParser, DocIR,
DefaultParser) · `chunk.rs` (Chunker, StructuralChunker) · `embed.rs` (Embedder, EngineEmbedder,
StubEmbedder, validate_dim) · `storage.rs` (ObjectStore, SupabaseStorage, InMemoryStore) · `store.rs`
(DocStore sqlx persistence) · `signals.rs` (quality emitters) · `ingest.rs` (Ingestor orchestrator) ·
`retrieve.rs` (RetrievalEngine, HybridRetriever, RerankProvider seam) · `secure.rs` (SecureExecutor seam,
Unsupported). Routes: `routes/documents.rs`, `routes/retrieve.rs`, additive `routes/rpc.rs`
(`documents_declassify`, `retrieval_set_config`; `authorize()`→`pub(crate)`). Wiring: `state.rs`, `main.rs`.

## Build order (each phase committed green — never merge on red)
- **A** DB delta + `hybrid_search` via `dbd reconcile` + SQL tests (dual-write, cross-tenant recall=0,
  classification/space membership, no-raw-secret) against the live DB.
- **B** Rust scaffold: Cargo deps + `rag/mod.rs` + frozen module signatures, compiling green.
- **C** Implement modules — fan out independent leaves (parse/chunk/embed/storage) in parallel worktrees
  with tests; build the coupled core (store/ingest/retrieve) + routes.
- **D** Wiring (`state.rs`/`main.rs`, feature-gated adapter registration) + e2e script + adversarial review.

## Endpoints
`POST /v1/documents` (doc.write) · `POST /v1/documents/:id/ingest` · `POST /v1/documents/:id/reingest?from=`
· `GET /v1/documents/:id` · `GET /v1/documents` · `GET /v1/documents/:id/assets` · `DELETE /v1/documents/:id`
(doc.delete) · `POST /v1/spaces/:space_id/retrieve` (doc.read + membership) · `GET
/v1/spaces/:space_id/retrieval-config` · `POST /rpc/retrieval/set-config` (retrieval.manage) · `POST
/rpc/documents/declassify` (doc.declassify).

## Phase D — adversarial security review (done 2026-08-01)
5 lenses (isolation / redaction / injection / authz / ops) → per-finding adversarial verification:
**15 raised, 13 confirmed.** Fixed (10): heading/caption redaction into `section_path` (HIGH — a
secret in a heading persisted raw at rest); re-ingest version-unique collision (HIGH); cross-space
create injection (HIGH); zip/image/download size caps + pdf-panic isolation (HIGH/MED DoS);
ingest/delete readable-gate (MED); per-space config read wired (no-hardcoded-ops); list ordering.
Deferred (3, documented): declassify stays capability-gated governance (not owner-scoped);
`hybrid_search`'s materialized `visible` CTE trades HNSW-ANN for exact correctness at v1 corpus
sizes (revisit with pre-filtered/iterative ANN at scale — **backlog**); cross-doc `content_hash`
dedup stored-but-not-enforced (**backlog**). Commit `84201ad`.

## Deferred (with seams left in place)
Cross-encoder rerank (RerankProvider→Unsupported; wide two-stage k already retrieved) · contextual
enrichment (`contextual_prefix` col exists, already in the generated `tsv`) · OCR Tier-1/2 (`ParseOpts.ocr`
seam; Tier-0 only) · §3c dataset compute (`SecureExecutor`→Unsupported; datasets tables exist, no route
mounted) · advanced modes (`RetrievalConfig.mode`; unknown→hybrid) · Grounded-Ask citation write into
`chat.rs` (`/retrieve` returns citation-ready chunk_ids; `message_citations` table exists) · NER Layer-2
(composes after the regex Redactor) · real tokenizer (`approx_tokens` swap point) · Realtime status channel
(polling `GET` covers v1; SSE `?watch=1` deferred) · frontend W2/W3.
