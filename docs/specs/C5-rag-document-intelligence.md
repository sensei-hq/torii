# C5 · RAG & document intelligence — Spec

**Module:** [C5](../modules/C5-rag-document-intelligence.md) · **Status:** Planned — build-ready · **Plane:** Central (+ desktop local plane via D2) · **Depends on:** F1 (schema), F2 (capabilities/JWT), F3 (field-level encryption, §3c), C1 (gateway/embedding + generation + privileged-write RPC), C4 (redaction/DLP wrapper + sensitive-data guard), C6 (`quality_signals` contract), Supabase Storage · **Enables:** W2 Library, W3 Playground, Ask (C1/C4), O1/O2 (via quality signals)
**Date:** 2026-07-23 · **Engine:** `sensei-*` crates @ `v0.4.6` · **Store:** PostgreSQL (Supabase) + `vector` + object storage
**Design basis:** [`../design/rag-and-document-center.md`](../design/rag-and-document-center.md) (research-backed) · conforms to [`../DECISIONS.md`](../DECISIONS.md) §3a/§3b/§3c and §2 W5.

---

> This spec turns the C5 design into a buildable contract. Where the design doc explores options,
> this spec **settles them** (§8) and states the concrete tables, endpoints, traits, RLS, and
> acceptance criteria. `DECISIONS.md` is the single source of truth; the mockups under
> `docs/mockups/app/*.jsx` are the authoritative UI ground truth. **No-hardcoded-ops**
> ([`project-gateway-no-hardcoded-ops`]): every model id, chunk size/overlap, fusion weight, `k`,
> rerank model, threshold, and enabled-mode set is **operator-managed config** with overridable
> fallback constants — never baked into the library.

---

## 1. Purpose & scope

C5 is the plane that turns tenant/space **documents and structured datasets** into **grounded,
cited answers**, and governs **how retrieval is performed per space**. It owns three surfaces over
one substrate:

- **C5 core** — the ingestion pipeline (markdown-first parse → redact-at-rest → chunk → embed →
  index), the composable retrieval engine, the embedding + rerank services, the sensitive-
  structured-data compute path (§3c), and the eval/quality-signal wiring (§3b).
- **W2 Library** — the document center: upload, collections/folders/tags, versioning & lineage,
  dedup, ingestion-status, preview (rendered md / table-as-grid / image gallery), extracted-asset
  browser.
- **W3 Playground** — the retrieval lab: mode selector, weight slider, rerank picker, chunking
  selector, retrieval **inspector**, and **promote-to-space-default**.

**Depends on:** F1 (owns the DDL for C5 tables), F2 (canonical capabilities + JWT claims), F3
(per-tenant DEK for §3c field encryption + credential vault), C1 (embedding chain execution,
grounded generation, and the gateway-mediated privileged-write RPC path), C4 (the consumer-side
redaction/DLP wrapper — §2 W5 — and the sensitive-data guard), C6 (the `quality_signals`
contract), Supabase Storage (originals + artifacts).

**Enables:** W2 Library, W3 Playground, the Ask experience (retrieval → grounded generation with
citations, orchestrated by C1/C4), and O1/O2 (retrieval/eval quality signals).

**Out of scope for v1 (design-only screens, v2 runtime — `DECISIONS.md` §3a):** collaborative
editing, comments, corrections, agent-driven chat-to-edit, `document_collaborators`; the
interaction-intelligence go-between (§3b); reversible un-redaction (v1 is one-way only, §2 W5);
richer §3c privacy (differential privacy, format-preserving tokenization); page-as-image (ColPali)
retrieval.

---

## 2. Responsibilities

1. **Ingest & normalize** documents (PDF/DOCX/PPTX/XLSX/HTML/images) markdown-first, always keeping
   and referencing the original; run the per-doc status pipeline (`queued→parsing→chunking→
   embedding→ready`/`failed`).
2. **Redact-at-rest (§2 W5)** — detect + redact secrets/PII in normalized markdown **before
   embedding** (one-way placeholders, v1) so the index never holds raw secrets; emit a signal per
   redaction.
3. **Chunk** along parsed structure (structural/semantic default), per-space configurable.
4. **Embed** via the chain-managed embedding capability (1024-dim, embedded-local or cloud).
5. **Retrieve** with the composable default stack (hybrid dense+BM25 → contextual → cross-encoder
   rerank → grounded+cited) and per-space feature-gated advanced modes.
6. **Rerank** as a **separate C5 service** (v1; crate `TextRerank` = `Unsupported`, GH-8) behind a
   provider-agnostic interface.
7. **Compute over sensitive structured data without exposing values (§3c)** — schema-to-LLM →
   execute-in-app inside the trusted boundary → aggregate/k-anon-gated result.
8. **Dedup + version** (content-hash, lineage, stale-chunk retirement) and manage the document
   center (collections/tags/preview/bulk).
9. **Emit quality/audit signals** (§3b) for every retrieval, every redaction, and every §3c
   compute → `quality_signals` (C6) → O1/O2.
10. **Provide retrieval-inspector data** (chunks, per-stage scores, dropped candidates, grounding,
    citation resolution) to W3.

---

## 3. Data model (F1 tables — owned/used)

F1 owns the DDL (see [`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md) and
`specs/F1-data-model.md` §5). C5 **owns** the document/dataset/embedding tables and **uses** the
Ask/quality/config tables. All tables are `tenant_id`-scoped with composite FKs (§F1.6).

### 3.1 Owned by C5

| Table | Purpose & key columns (beyond the F1 conventions `id`/`tenant_id`/`created_at`/`modified_at`/`modified_by`) |
|---|---|
| `documents` | `space_id`, `scope` (`org`\|`space`\|`individual`), `owner_id`, `title`, `mime`, `content_hash` (SHA-256 of original bytes, dedup), `current_version_id`, `classification` (`public`\|`internal`\|`confidential`\|`restricted`), `status` (`queued`\|`parsing`\|`chunking`\|`embedding`\|`ready`\|`failed`), `status_reason`, `collection_id` (nullable). |
| `document_collections` | Folders/collections: `name`, `parent_id` (self-ref, in-tenant), `space_id`, `tags text[]`. |
| `document_versions` | `document_id`, `version_no`, `content_hash`, `size_bytes`, `parser`, `parser_version`, `superseded_at` (stale-chunk retirement marker), `created_by`. Re-upload of changed bytes = new row. |
| `document_assets` | Object-storage refs, one row per artifact: `document_id`, `version_id`, `kind` (`original`\|`ir_json`\|`markdown`\|`table_csv`\|`image`\|`caption`), `storage_uri`, `content_hash`, `bytes`, `page_ref int`, `bbox jsonb` (evidence-pin coords), `caption text` (for images). Originals are immutable + hash-addressed. |
| `document_embeddings` | The chunk index (one logical unit for dense **and** lexical): `document_id`, `version_id`, `chunk_no`, `parent_chunk_id` (small-to-big), `chunk_text`, `contextual_prefix` (§2.6 blurb), `embedding vector(1024)` (HNSW), `tsv tsvector` (GIN, BM25 leg — §8.1), `page_ref`, `section_path text` (H1>H2>H3), `char_offset int`, `bbox jsonb`, `element_type` (`prose`\|`table`\|`caption`), `redaction_count int`. **Re-pointed to the space+classification ACL** (F1 §5 fix; was `vector(384)`). |
| `datasets` (§3c) | Structured dataset: `space_id`, `owner_id`, `source_document_id` (nullable — from an extracted table), `name`, `logical_table` (multi-table split), `row_count`, `storage_uri` (JSON/CSV/Parquet in object storage), `plane_pin` (`auto`\|`local`) for local-only compute, `status`. |
| `dataset_columns` (§3c) | Per-column schema: `dataset_id`, `name`, `type`, `description`, `stats jsonb` (min/max/distinct/aggregates — non-sensitive only), `sensitivity` (`public`\|`internal`\|`sensitive`\|`restricted`), `encrypted bool`. Sensitive/restricted values are **field-encrypted per-tenant (F3 DEK)** at rest. |

### 3.2 Used by C5 (owned elsewhere)

| Table | Owner | C5 use |
|---|---|---|
| `conversations` / `messages` / `message_citations` | C1/C4 (Ask) | C5 supplies retrieved-chunk provenance; `message_citations` rows resolve to `document_embeddings` chunk + `document_assets` bbox. |
| `quality_signals` | C6 (F1 store) | C5 writes retrieval/eval/redaction/§3c-compute signals keyed to `inference_calls`/`messages` (service_role-write). |
| `spaces` / `settings` | F1 / W1 | Per-space retrieval + chunking config (JSON: mode, fusion weights, chunker + params, enabled advanced modes, rerank model, contextual on/off, top-k). |
| `router_credentials` | F3 | Never touched directly by C5; embedding/rerank cloud calls resolve credentials inside C1 (§2 W4). |
| `inference_calls` | C1 (ledger) | Embedding, rerank, caption, judge, and §3c synthesis calls are metered here (service_role-only). |
| `feature_states` / `user_preferences` | C4/O3 | 4-state feature governance for advanced retrieval modes (workspace→space→role→user). |

**Retired (not used):** `access_groups`/`group_levels`/`document_access`/`profile_groups`/
`user_accessible_documents` (§F1). ACL = space membership + fixed 4-level classification only.
**v2 (design-only in v1):** `document_collaborators`, comment/suggestion tables.

---

## 4. Contracts

C5 runs in the central `services/gateway` process (shares the Axum app + `sensei-*` engine with
C1) and, on the desktop, in the D2 local gateway (Tauri sidecar). All HTTP is behind C1 auth
(RS256/JWKS JWT or `api_keys`); privileged writes route through C1 domain RPC (§5).

### 4.1 HTTP endpoints (central plane)

Ingestion & document center:
```
POST   /v1/documents                      # register + get a signed upload URL (or multipart)
       → { document_id, upload_url, version_no }
PUT    <upload_url>                        # client PUTs original bytes to object storage
POST   /v1/documents/:id/ingest            # begin/resume the pipeline for the uploaded version
GET    /v1/documents/:id                   # metadata + status + status_reason + versions
GET    /v1/documents/:id/assets            # list document_assets (md/csv/image/ir refs, signed)
POST   /v1/documents/:id/reingest          # re-run from a stage (idempotent); optional ?from=chunking
DELETE /v1/documents/:id                   # soft-delete + retire chunks (capability doc.delete)
GET    /v1/documents?space_id=&collection=&tag=&status=   # list/filter
```

Retrieval & inspector (backs W3 + feeds Ask):
```
POST   /v1/spaces/:space_id/retrieve
  req  { query, top_k?, config_override?, inspect?:bool, session_only?:bool }
  res  { chunks:[{chunk_id, document_id, text, section_path, page_ref, bbox,
                  scores:{dense, bm25, fused, rerank}, dropped:bool}],
         stages:[{name, k_in, k_out, recall_at_k?, ms}],
         grounding_ready:bool, config_used, redactions:int }
POST   /rpc/retrieval/set-config               # promote-to-default write (capability retrieval.manage)
GET    /v1/spaces/:space_id/retrieval-config   # read the resolved config
```
Grounded **Ask** (generation) is orchestrated by **C1/C4**: C1 calls `/v1/spaces/:id/retrieve`,
runs the C4 redact-in-flight + grounded-generation guardrails, streams the answer over SSE, and
persists `messages` + `message_citations`. C5 does not own generation.

Sensitive structured data (§3c):
```
POST   /rpc/datasets/create                # ingest CSV/XLSX or promote an extracted table (dataset.manage)
POST   /rpc/datasets/set-schema            # (re)classify column sensitivity (capability dataset.manage)
POST   /v1/datasets/:id/compute            # schema-to-LLM → execute-in-app (query — read-shaped)
  req  { question, plane_pin? }
  res  { plan:{sql|formula}, result:<aggregate/derived only>, k_anon_ok:bool,
         suppressed_groups:int, redactions:int, executed_plane:'local'|'cloud' }
```

### 4.2 Tauri IPC (desktop local plane, via D2)

Sensitive datasets and local-only docs run entirely on-device (§7); commands mirror the HTTP
shapes and never egress raw values:
```
c5_ingest_document(path, space_id, scope)      -> { document_id, status }
c5_document_status(document_id)                -> { status, status_reason, stages }
c5_retrieve(space_id, query, config_override?) -> RetrieveResult   # local index
c5_dataset_compute(dataset_id, question)       -> ComputeResult     # local model + local exec
```

### 4.3 Rust traits (C5-owned, provider-agnostic — no-hardcoded-ops)

```rust
// Parse any supported format to the canonical IR (Docling default; operator-selectable backend).
trait DocumentParser { fn parse(&self, bytes:&[u8], mime:&str, opts:&ParseOpts) -> Result<DocIR>; }

// Chunk along IR structure; strategy + params from per-space config.
trait Chunker { fn chunk(&self, ir:&DocIR, cfg:&ChunkConfig) -> Result<Vec<Chunk>>; }

// v1 rerank runs here (crate TextRerank = Unsupported, GH-8). Selectable: self-hosted BGE (ORT),
// hosted (Cohere/Voyage), or none — per tenant/route.
trait RerankProvider { async fn rerank(&self, query:&str, cands:&[Candidate], top_k:usize)
                                       -> Result<Vec<Ranked>>; }

// Redaction is the C4 wrapper's contract, invoked here at ingestion (before embedding).
trait Redactor { fn redact(&self, text:&str, cfg:&RedactConfig) -> Redacted; } // one-way, v1

// Composable retrieval; assembles legs → fuse (RRF) → rerank → assemble context.
trait RetrievalEngine { async fn retrieve(&self, space:Uuid, q:&Query, cfg:&RetrievalConfig)
                                          -> Result<RetrieveResult>; }

// Sandboxed, read-only executor for §3c plans (SELECT-only, statement timeout, row/cost caps).
trait SecureExecutor { fn execute(&self, plan:&Plan, ds:&DatasetHandle) -> Result<GatedResult>; }
```
Embedding is **not** a C5 trait — it is a chain-managed capability invoked via the engine
(`EmbedModel`, §7 / C1); C5 requests embeddings through the embedding chain.

### 4.4 Events

- **Ingestion-status events** — one per stage transition, on an RLS-scoped Supabase Realtime
  channel `documents:<space_id>` (payload `{document_id, status, status_reason, stage_ms}`); backs
  the W2 status UI. Also available via SSE on `GET /v1/documents/:id?watch=1`.
- **Quality signal** — every retrieve/redact/compute emits a `quality_signals` row (§8) → O1
  audit stream → O2 rollup.

---

## 5. Security & RLS

**Authz via capabilities (F2-owned canonical set).** C5 checks capabilities server-side (never
UI-only). Every capability C5 guards on is in the F2 canonical set (§4.3): `space.join`/
`space.create`, `doc.read`/`doc.write` (upload/ingest/edit-metadata), `doc.delete`,
`doc.declassify`, `retrieval.manage` (promote-to-space-default), and `dataset.manage` (column
sensitivity + allowed-ops policy). C5 **requests F2 add** only `dataset.compute` (run §3c
compute), still absent from §4.3. F2 owns the authoritative list; these are C5's required grants.

**Gateway-mediated writes (§2 W1).** Privileged mutations — `documents.classification` (declassify),
retrieval-config promote, dataset sensitivity policy, cross-space moves — are **`service_role`-write
only** and go through **C1 domain RPC** that checks the capability. Clients get tenant+space+
classification-scoped **SELECT** and self-owned benign writes only (own draft doc metadata, own
`user_preferences`, session-only Playground overrides). No direct PostgREST writes to privileged
columns.

**Tenant isolation at the index/namespace layer, not app code (design §9).** `document_embeddings`,
`documents`, `datasets` carry `tenant_id` + RLS `tenant_id = (auth.jwt()->>'tenant_id')::uuid`,
composed with space membership + the fixed 4-level classification predicate (`public`/`internal` →
tenant members; `confidential` → space members; `restricted` → doc/space owner). Vector search is
constrained by a **hard per-tenant filter** so a query embedding cannot surface another tenant's
neighbors (OWASP LLM 2025 #8). RLS uses the F2 `SECURITY DEFINER` capability/role resolver for
predicate checks.

**Object storage.** Buckets are tenant/space-scoped; access via short-lived signed URLs minted
server-side after the RLS/classification check. Originals + derived artifacts are per-tenant
isolated and encrypted at rest.

**Secrets & redaction (§2 W5, one-way v1).** Ingestion redacts secrets/PII in normalized markdown
**before embedding** (layered regex+entropy+checksums then transformer NER — vetted libs, not
hand-rolled). The vector store/index therefore never holds raw secrets — the only defense that
survives embedding inversion. **v1 = one-way placeholders; NO reversible mapping store** (overrides
the C5 seed's "redaction-mapping store" mention, per `DECISIONS.md` §2 W5). Detected active secrets
are **flagged for rotation**, not merely masked. Redaction/audit logs are themselves scrubbed.
Retrieved chunks flow through the same C4 redact-in-flight pass at C1/C4 inference and X1 tool
egress.

**§3c field encryption.** Sensitive/restricted columns are encrypted per-tenant (F3 DEK),
decryptable only inside the trusted boundary (central `service_role` or the on-device plane). The
LLM sees schema + non-sensitive metadata/aggregates only; results pass the W5 redaction check and
k-anon gate before egress. §3c compute is fail-closed (§7.4).

**Audit.** Declassify, dataset-policy change, export, and every §3c compute emit `audit_events`
(actor-bound, O1) + a quality signal.

---

## 6. Key flows

1. **Ingest a document.** Client `POST /v1/documents` → gets signed upload URL → PUTs original
   bytes → `POST .../ingest`. Pipeline (each stage idempotent, status persisted, Realtime-emitted):
   `queued` → **parse** (Docling → IR: reading order, headings, tables-as-cells, figures+captions,
   bboxes; export md + table CSVs + captioned image assets; tiered OCR fallback if no clean text
   layer) → **redact-at-rest** (detect+redact secrets/PII in md, one-way; flag active secrets) →
   **chunk** (structural/semantic default, per-space config; tables chunked whole) → **contextual
   enrich** (prepend LLM blurb, default-on above threshold) → **embed** (1024-dim chain) + build
   `tsv` (dual-write dense+lexical as one unit) → `ready`. Any failure → `failed` + machine-readable
   `status_reason`; re-runnable via `/reingest`.
2. **Dedup + versioning.** On upload, compute SHA-256; exact-hash match (tenant-partitioned) →
   idempotent no-op (link existing). Changed bytes for an existing doc → new `document_versions`
   row; on `ready`, **atomically retire the prior version's chunks** (`superseded_at`) so the index
   never holds contradictory content.
3. **Default-stack retrieval.** `POST /v1/spaces/:id/retrieve`: conversational rewrite (multi-turn)
   → run dense (pgvector ANN) + BM25 (Postgres FTS) legs under the tenant+space+classification
   filter → **RRF fuse** (`k=60`) → retrieve ~100–150 → **cross-encoder rerank** (C5 service) → keep
   top ~10–20 → assemble ~6–10 chunks with must-include-top + dedupe. Returns chunks + per-stage
   scores (+ inspector detail if `inspect`). C1/C4 then run grounded generation with citations
   (`message_citations` resolve to chunk + bbox evidence-pin).
4. **Sensitive structured-data compute (§3c).** `POST /v1/datasets/:id/compute`: prune schema
   (schema linking) → send **schema + non-sensitive metadata/aggregates only** to the LLM → LLM
   emits a plan (text-to-SQL/formula) → **guardrail pipeline (fail-closed):** SQL AST validate
   (SELECT-only; reject DDL/DML/multi-statement/dynamic/procs) → policy check vs tenant catalog →
   `SecureExecutor` runs read-only inside the boundary (statement timeout, row/cost caps, sensitive
   columns decrypted only here) → **aggregate/k-anon gate** (suppress groups < k) → W5 redaction
   check → return derived result only. Sensitive datasets `plane_pin='local'` execute on-device.
   Emits audit + quality signal.
5. **Advanced modes (feature-gated per space).** GraphRAG/LazyGraphRAG, RAPTOR, ColBERT/multi-
   vector, SQL-RAG, agentic retrieve→reason→re-retrieve, HyDE/step-back/decomposition are enabled
   per space via 4-state governance (workspace→space→role→user). Members' Playground experiments are
   session-only (`session_only:true`); admins/space-owners `PUT` the space default
   (`retrieval.manage`).
6. **Promote-to-space-default (W3).** After tuning in the inspector, an admin/space-owner `PUT`s the
   config to `spaces`/`settings` via the C1 RPC (capability-checked).
7. **Desktop local plane (D2).** `c5_ingest_document`/`c5_retrieve`/`c5_dataset_compute` run
   ingestion, embedding (`EmbeddedLlamaAdapter`/`OrtAdapter`, in-process, no daemon), retrieval, and
   §3c compute entirely on-device; sensitive datasets never leave the machine.
8. **Quality-signal emission.** Every retrieve/redact/compute writes a `quality_signals` row (§8)
   keyed to `inference_calls`/`messages` → O1 audit stream → O2 analytics; backs the W3/Ask live
   meters.

---

## 7. Embedding, rerank & §3c compute internals

### 7.1 Embedding (chain-managed capability, `DECISIONS.md` §3)
- **1024-dim**, to match `document_embeddings vector(1024)`. Bound via an **embedding chain**
  (same fallback/circuit-breaker/per-step-plane machinery as chat chains); capability is per-model
  (`model_capabilities.embed`), not per-provider.
- Desktop local = embedded in-process (`EmbeddedLlamaAdapter` GGUF embed, or `OrtAdapter` ONNX) —
  **no external Ollama daemon**; `fastembed` disabled (GH-3 resolved). Cloud embed models bind via
  the same chain for the cloud plane. Sensitive datasets pin to the local plane.

### 7.2 Rerank (separate C5 service, GH-8)
- **Default:** self-host `BAAI/bge-reranker-v2-m3` (Apache-2.0, multilingual) via ORT for
  cost/latency/data-residency; Cohere/Voyage Rerank as opt-in managed options. Avoid Jina v2 base
  weights in the paid product (CC-BY-NC). Provider-agnostic `RerankProvider` (§4.3).
- **Two-stage:** retrieve ~100–150 → rerank → top ~10–20 (fixes precision, not recall).
- **Adaptive:** fast mode (no rerank) default for easy queries; deep mode triggered by low
  retrieval confidence / high-risk intent / explicit citation requests. Gate every deployment on
  NDCG@k, recall pre-vs-post rerank, and p95/p99 latency (§8); remove on routes where NDCG is flat.

### 7.3 Lexical (BM25) leg
- Postgres FTS (`tsvector`/GIN on `document_embeddings.tsv`) is the v1 BM25 leg, **dual-written with
  the dense vector as one logical unit** (any add/update/delete writes both — a stale sparse index
  is the most common hybrid bug). See §8 decision on the store.

### 7.4 §3c secure executor
- `SecureExecutor` over per-dataset **read-only DuckDB** (CSV/Parquet in the boundary): SELECT-only
  AST allow-list, statement timeout, row/cost caps, no filesystem/network. Any Pandas/code path is
  sandboxed. Repaired queries are re-validated; high-risk/ambiguous escalate to human review.

---

## 8. Decisions resolved

Settling the design doc §11 open questions and the C5-seed open questions, per the DEFAULTS:

1. **BM25/lexical engine → Postgres FTS alongside pgvector, one logical unit.** v1 keeps a single
   store (pgvector + `tsvector`/GIN in the same Postgres) so RLS, tenant partitioning, and
   transactional dual-write apply uniformly with no new infra; RRF fuses the two legs. A native-
   hybrid store (Qdrant/Weaviate/Vespa) or a true-BM25 extension (ParadeDB `pg_search`, if
   available on the managed instance) is a **later** swap behind `RetrievalEngine` if FTS ranking
   proves insufficient. *Rationale: no-hardcoded-ops + minimize v1 ops surface; RLS correctness is
   easier in one store.*
2. **Rerank topology → in-process C5 service (ORT self-hosted BGE) default; provider-agnostic.**
   Keeps tenant chunks inside the boundary (data-residency) at ~50–100ms; hosted APIs
   (Cohere/Voyage) are opt-in per tenant. Interface is provider-agnostic regardless (GH-8). *A
   `RerankModel` gateway trait is a later optional issue; v1 does not block on it.*
3. **Contextual enrichment → default-on above a size threshold, per-space overridable.** Skip for
   very small corpora (whole-doc-in-context) and re-contextualize only on `content_hash` change to
   bound churn cost; cheap model + prompt caching. *Rationale: the 35→67% failure-reduction gains
   compound and matter most on heterogeneous corpora; cost is bounded by threshold + change-gating.*
4. **Parser → Docling default; operator-selectable backends.** Self-hostable, strong table fidelity
   + bbox provenance, broad format support. Marker/MinerU/MarkItDown/cloud agentic parsers are
   operator-selectable; cloud parsers (which egress content) are gated behind per-tenant policy with
   data-locality default = self-hosted.
5. **OCR → tiered, confidence-routed.** Tier 0 skip if a clean text layer exists; Tier 1 CPU OCR
   (PaddleOCR/Tesseract) for clean scans; Tier 2 VLM OCR (olmOCR/Qwen-VL-class) for mid-confidence
   or known-hard docs; always run a layout pass before chunking. Thresholds + model = operator
   config.
6. **Chunking default → structural/semantic (layout-first, two-stage) + parent-document overlay.**
   512-token chunks, 10–20% overlap; tables chunked whole; not blind pure-semantic (~14x cost for
   often-parity recall). Per-space overridable.
7. **Redaction → one-way placeholders only in v1; NO reversible mapping store.** Per `DECISIONS.md`
   §2 W5 (overrides the C5 seed). Reversible un-redaction for authorized roles is post-v1.
8. **§3c executor → sandboxed read-only DuckDB inside the boundary; SELECT-only AST allow-list.**
   Aggregate-only + k-anonymity min-group gating; sensitive columns decrypted only in-boundary
   (F3 DEK); local-plane pin for on-device datasets.
9. **Advanced modes → default stack fixed & ship-enabled; GraphRAG/RAPTOR/ColBERT/SQL-RAG/agentic
   feature-gated per space, off by default.** GraphRAG engine = **LazyGraphRAG** when built
   (index-cost ≈ vector RAG, ~700x cheaper queries), per-tenant graph namespace partition;
   scheduled after the default stack proves out.
10. **C6/`quality_signals` → C5 writes to the C6-owned contract.** If C6 is not ratified, C5 writes
    the same signals via C4 (capture)/O1 (audit)/O2 (analytics). C5 does not own the store.
11. **Multi-vector (ColBERT) storage → deferred; ~2–4x per-tenant storage premium must be modeled
    into quota/billing before it ships** (C3/O2).

---

## 9. Acceptance criteria (observable, testable)

**Ingestion & document center**
- Uploading a PDF/DOCX/PPTX/XLSX/image drives `documents.status` through `queued→parsing→chunking→
  embedding→ready`, each transition observable via the Realtime channel and `GET /v1/documents/:id`;
  a forced parse failure lands `failed` with a non-empty `status_reason` and is recoverable via
  `/reingest`.
- After ingest, `document_assets` contains the original (immutable, hash-addressed), the IR JSON,
  normalized markdown, one CSV per table, and captioned image assets; the original is always
  retrievable.
- Re-uploading identical bytes is a no-op (no duplicate chunks); re-uploading changed bytes creates
  a new `document_versions` row and the prior version's chunks are retired (`superseded_at` set) —
  a retrieval after re-ingest returns **no** stale-version chunks.

**Redaction (§2 W5)**
- A document containing a live API key + an email + an SSN yields `document_embeddings.chunk_text`
  with **placeholders only** (no raw secret/PII), verified by scanning stored chunks; the secret is
  flagged for rotation; a `quality_signals` redaction row is written. No reversible mapping row
  exists anywhere (v1).

**Retrieval**
- `/v1/spaces/:id/retrieve` returns dense + BM25 + fused + rerank scores per chunk and per-stage
  `k_in/k_out`; with `inspect:true` it returns dropped candidates and per-stage timings.
- Adding/updating/deleting a chunk updates **both** the vector and `tsv` indexes in one transaction
  (no stale sparse index — asserted by a dual-write test).
- Grounded Ask produces `message_citations` that each resolve to a real chunk + (where coords exist)
  a bbox evidence-pin.

**Security / isolation**
- A member of tenant A retrieving in tenant A **never** receives tenant B chunks even with an
  adversarial near-duplicate query embedding (cross-tenant recall = 0).
- A non-space-member cannot read a `confidential` doc's chunks; a non-owner cannot declassify a
  `restricted` doc (declassify only via C1 RPC with `doc.declassify`); a Playground member override
  is session-only and cannot mutate `spaces`/`settings` without `retrieval.manage`.

**§3c sensitive structured data**
- `/v1/datasets/:id/compute` on a dataset with a `sensitive` salary column returns an aggregate
  result **without** any raw salary value; a plan containing non-SELECT SQL is rejected fail-closed;
  a group below the k-anon threshold is suppressed (`suppressed_groups > 0`); a `plane_pin='local'`
  dataset executes on-device (`executed_plane='local'`). Every compute writes an audit + quality
  signal.

**Quality signals & eval**
- Every retrieve/redact/compute writes a `quality_signals` row (recall/precision, rerank NDCG,
  grounding, cost, latency, fallbacks, guardrail/W5 hits, "why this model") keyed to
  `inference_calls`/`messages`; the offline eval suite runs the metric set on a versioned test set
  in CI and gates config/model swaps on regression thresholds.

**No-hardcoded-ops**
- Chunk size/overlap, fusion weights, top-k, rerank model, contextual on/off, enabled advanced
  modes, OCR thresholds, and parser backend are all read from per-space config / operator config
  (asserted: changing a space's config changes behavior with no code change).

---

## 10. Gateway-crate dependencies

Engine = the six `sensei-*` crates @ **`v0.4.6`** (no `gateway-embedded`, no `InferenceAdapter`).

- **GH-3 (resolved, no crate change)** — local embedding via `EmbeddedLlamaAdapter` (GGUF embed,
  in-process) / `OrtAdapter` (ONNX). C5 wires a **1024-dim** embed model into the embedding chain;
  `fastembed` disabled.
- **GH-8 (v1 uses C5 service, not blocking)** — `TextRerank` is a reserved `Unsupported` variant;
  C5 runs cross-encoder rerank as a **separate service** behind `RerankProvider`. A `RerankModel`
  gateway trait is a later optional issue.
- **GH-6 (investigate, C4-owned)** — streaming-safe redaction hook: redacting `execute_stream`
  output before egress may need a crate stream-transform point. C5's redact-**at-rest** does not
  depend on it; retrieved-context redact-in-flight (C4) does.
- **GH-5 (F1/C3)** — `inference_calls` ledger shape; C5's embed/rerank/caption/judge/§3c-synthesis
  calls are metered here with node attribution.
- **Reuse:** `GatewayStore` (persist inference calls), the embedding chain (`EmbedModel`),
  per-model capability (`model_capabilities`), per-step `plane` (`local|cloud`, GH-1) so a
  sensitive dataset's steps pin local.

No **new blocking** gateway issue is introduced by C5 (rerank stays a C5 service). See
[`../plans/gateway-issues.md`](../plans/gateway-issues.md).

---

## 11. Open questions (genuine)

1. **Managed-Postgres BM25 quality.** Is Postgres FTS `ts_rank_cd` ranking good enough as the BM25
   leg, or must we enable ParadeDB `pg_search` / move to a native-hybrid store? Depends on
   extension availability on the deployed Supabase instance and observed hybrid recall.
2. **Realtime vs SSE for ingestion status** at scale — which is the primary transport for the W2
   status UI when a tenant bulk-uploads hundreds of docs (channel fan-out vs per-doc SSE).
3. **VLM captioning + Tier-2 OCR model on the desktop local plane** — which on-device model fits the
   embedded footprint (memory/latency) while keeping captions useful for retrieval.
4. **LazyGraphRAG per-tenant graph namespace** build/index infra and its interaction with the
   pgvector store (co-located vs separate) — deferred with the feature-gate, but the namespace
   partition model needs design before the GraphRAG phase.
5. **§3c semantic/metrics layer** — for governed recurring questions, do we add a curated
   metrics/semantic layer over datasets (safer, cacheable) vs raw text-to-SQL each time?
6. **Re-contextualization cost accounting** — how the contextual-enrichment token cost on churny
   corpora is attributed/metered per tenant (budget interaction with C3).
