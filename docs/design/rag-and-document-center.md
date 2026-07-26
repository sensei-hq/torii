# Torii — RAG & Document-Intelligence Design (C5 · W2 Library · W3 Playground)

> **Status:** DESIGN (research-backed). Authored per [`DECISIONS.md`](../DECISIONS.md) §3a
> (document center + RAG), §3b (quality signals), §3c (sensitive structured data), and §2 W5
> (secret/PII redaction). `DECISIONS.md` is the single source of truth; where this doc and it
> disagree, the decision record wins. The mockups under `docs/mockups/app/*.jsx` remain the
> authoritative UI ground truth.
>
> This design assimilates 2025–2026 published RAG best practice (contextual retrieval, hybrid
> fusion, semantic/structural chunking, cross-encoder + late-interaction reranking, GraphRAG /
> LazyGraphRAG / RAPTOR, privacy-preserving text-to-SQL, and RAG evaluation). Every choice is
> grounded in a Torii decision and, where useful, an external source (cited inline).

---

## 1. Purpose & scope

**C5 (RAG & document intelligence)** is the plane that turns tenant/space documents and datasets
into grounded, cited answers, and that governs how retrieval is performed per space. This design
covers three surfaces that share one substrate:

- **C5** — the ingestion pipeline, retrieval engine (composable modes), embedding + rerank
  services, sensitive-structured-data compute, and the evaluation/quality-signal wiring.
- **W2 Library** — the **document center**: upload, collections/folders/tags, versioning &
  lineage, dedup, ingestion-status, preview (rendered md / table-as-grid / image gallery), and
  the extracted-asset browser (`DECISIONS.md` §3a "Document center").
- **W3 Playground** — the interactive retrieval surface: retrieval-mode selector, weight slider,
  rerank picker, chunking selector, retrieval **inspector**, and **promote-to-space-default**
  (`DECISIONS.md` §3a "Retrieval (v1, composable per space)").

### Mapping to modules and schema

| Concern | Owner | Key F1 tables (per §5) |
|---|---|---|
| Ingestion → markdown-first artifacts | C5 | `documents` (+`content_hash`, `scope`, `owner_id`, `space_id`, status), `document_collections`, `document_versions`, `document_assets` (originals + normalized md/CSV/images in object storage) |
| Chunk index & vector search | C5 · F1 | `document_embeddings vector(1024)` (fix from `vector(384)`, §5 "Fix") |
| Retrieval config per space | C5 · W3 | per-space retrieval/chunking config on `spaces`/`settings` (§5 "Document center") |
| Redaction (§2 W5) | C4 wrapper / C5 ingestion | applied at ingestion **before embedding**; signals to `quality_signals` |
| Sensitive structured data (§3c) | C5 · C4 · F3 | structured **datasets** + per-column schema/sensitivity + field-level encryption |
| Grounded answers with citations | C1/C4 · C5 | `conversations`, `messages`, `message_citations` |
| Evaluation & quality signals (§3b) | C5 → C4 · O1/O2 (C6) | `quality_signals` keyed to `inference_calls`/`messages` |
| Embedding & rerank capability | gateway chains | embedding chain (per §3 "capabilities are chain-managed"); **rerank = separate C5 service** (§3) |

**Out of scope for v1 (design-only):** collaborative editing, comments, corrections, and the
agent-driven chat-to-edit runtime — these ship with X2 in v2 (`DECISIONS.md` §3a "Ownership &
collaboration"). The interaction-intelligence go-between (§3b) is likewise v2.

**No-hardcoded-ops constraint.** Per [`project-gateway-no-hardcoded-ops`], model IDs, chunk
sizes/overlap, fusion weights, `k`/top-k, rerank model, entropy/confidence thresholds, and enabled
retrieval modes are **operator-managed config** with overridable fallback constants — never baked
into the gateway library.

---

## 2. Ingestion pipeline

Ingestion is markdown-first: parse once into a rich structured intermediate representation (IR),
export markdown + CSV/asset artifacts, **always keep and reference the original**
(`DECISIONS.md` §3a). Parsing errors cascade into chunking → embedding → retrieval and compound
into hallucinations, so extraction fidelity has higher leverage than chunker tuning.

### 2.1 Per-document status pipeline

```
queued → parsing → chunking → embedding → ready
                                    └──────────→ failed  (any stage, with reason)
```

Status is persisted on `documents.status` and surfaced in the W2 ingestion-status UI. Each stage
is idempotent and re-runnable; a failed stage records a machine-readable reason for retry.

### 2.2 Parse → markdown-first canonical IR

Parse into a structured IR (reading order, heading hierarchy, tables as cells, figures + captions,
page numbers, bounding boxes), then export Markdown/CSV/JSON from it. **Persist three artifacts per
document** in `document_assets`:

1. **Original bytes** — immutable, content-hash-addressed, in tenant/space-scoped object storage.
2. **Structured IR** — JSON (reading order, tables, bboxes, page numbers) so we can re-chunk /
   re-serialize without re-parsing, and drive **evidence-pin citations** (bbox highlight).
3. **Serialized artifacts** — normalized markdown, table CSVs, extracted/captioned image assets.

**Default parser: Docling** (self-hostable, strong table fidelity, bbox provenance, broad format
support — PDF/DOCX/PPTX/XLSX/HTML/images) [IBM Docling]. Marker (GPU, check GPL), MinerU,
MarkItDown, and cloud agentic parsers (LlamaParse-class) are **operator-selectable backends**, not
the baked-in default — consistent with no-hardcoded-ops. Cloud parsers egress document content, so
they are gated behind per-tenant policy (data-locality default = self-hosted).

Format-specific handling:

- **Tables → CSV + Markdown.** Reconstruct from the layout model's cell structure (never from raw
  PDF text streams, which linearize columns wrong). Serialize to **Markdown by default**; **HTML**
  for genuinely nested/merged-cell tables; **CSV** stored as a separate asset for structured-data
  querying (§7). Never split a table across chunks — chunk each table as a unit with its
  title/caption; oversized tables split by row-groups repeating the header
  [file2markdown; TDS "relational shape"].
- **Images/figures → caption + reference.** A VLM generates descriptive alt-text/captions at
  ingestion, indexed as text alongside body content, **storing a reference to the original image
  crop** so we can fall back to pixels or (later) page-as-image retrieval [NVIDIA RAG Blueprint].
- **Formulas → LaTeX** for scientific/technical corpora (dedicated MER, not a generic parser that
  flattens math). Optional, corpus-gated.

### 2.3 OCR fallback (tiered, confidence-routed)

- **Tier 0** — detect an embedded text layer; if clean digital text exists, **skip OCR**.
- **Tier 1** — fast CPU OCR (PaddleOCR/Tesseract) for clean scans; accept if confidence high
  (~≥0.90).
- **Tier 2** — escalate mid-confidence (~0.70–0.90) or known-hard docs (handwriting, skew, complex
  tables) to a **VLM OCR** (olmOCR / Qwen-VL-class).

Then always run a layout pass before chunking — "just OCR it" is insufficient for RAG (recovers
text, not structure) [slavadubrov OCR guide]. Confidence thresholds and OCR/VLM model choice are
**operator config**.

### 2.4 Dedup + versioning/lineage

- **Content-hash dedup, before embedding.** Compute SHA-256 at document **and** chunk granularity;
  store on `documents.content_hash` (§5 "Document center"). Exact-hash makes re-ingest idempotent
  and stops duplicate chunks; optional MinHash/LSH catches near-duplicates. **All dedup is
  strictly tenant-partitioned** to prevent cross-tenant collisions/leakage. Dedup must run before
  splitting, or the chunk→source association is lost.
- **Versioning & lineage.** Re-upload of a changed document = **new version** in
  `document_versions` (history kept, `DECISIONS.md` §3a). On hash change, **atomically retire the
  prior version's chunks** (stale-chunk retirement) so the index never accumulates contradictory
  content. Every chunk carries source URI + page/section/offset + bbox so answers are current,
  citable, and audit-ready.

### 2.5 Redact-at-rest (§2 W5) — BEFORE embedding

Per `DECISIONS.md` §2 W5, ingestion detects and redacts secrets/PII in the normalized markdown
**and before embedding**, so the vector store/index never holds raw secrets. **v1 uses one-way
placeholders only — no reversible mapping store** (reversible un-redaction for authorized roles is
post-v1). This is the only defense that survives a perfect embedding-inversion attack (OWASP LLM
2025 #8: embeddings are recoverable, not one-way hashes) [OWASP; Philterd].

Two-stage layered detection (per §2 W5 "vetted libraries, not hand-rolled regex"):

1. **Layer 1 (~0ms):** regex + checksums + Shannon entropy — email/phone/SSN/credit-card (Luhn)/IP/
   API-key & token patterns / high-entropy secrets.
2. **Layer 2 (~50–200ms):** transformer NER (GLiNER-class, e.g. via ONNX in-process, or a
   Presidio + GLiNER sidecar) for names/orgs/locations and implicit identifiers.

Regex-only silently leaks names in prose — do not ship it alone; hybrid regex+NER reaches
~0.97 precision / ~0.98 recall [Presidio+GLiNER]. Detected **active secrets must be flagged for
rotation**, not merely masked ("zombie leaks" stay valid). Every redaction is a quality/audit
signal (§8). Detector rulesets, entity types, and thresholds are operator-configurable
(no-hardcoded-ops); redaction/audit logs are themselves scrubbed so the DLP layer isn't a leak.

The same redaction pass runs **redact-in-flight** on retrieved context, prompts, agent messages,
and MCP tool I/O at C1/C4 inference and X1 tool egress (§2 W5 three enforcement points) — that path
is owned by the C4 wrapper, referenced here because retrieved chunks flow through it.

### 2.6 Contextual chunk enrichment (index-time, optional but default-on)

Prepend a short (~50–100 token) LLM-generated blurb situating each chunk in its parent document,
then feed the enriched text to **both** the embedding model and the BM25 index (Anthropic
Contextual Retrieval). Reported retrieval-failure reductions: 35% (contextual embeddings), 49%
(+contextual BM25), 67% (+reranking) — 5.7% → 1.9% top-20 failure [Anthropic]. Run with a cheap
model + prompt caching (~$1.02 / 1M doc tokens). The enrichment model/prompt is operator config.
Re-contextualization on document change is a cost to budget for churny corpora. For very small docs
(< ~200K tokens total) prefer whole-doc-in-context over chunked retrieval where feasible.

---

## 3. Chunking

Chunking runs downstream of the layout parser, **along the parsed structure** (headings, sections,
element types), not fixed character windows. Strategy is **configurable per space** (persisted on
`spaces`/`settings`, §5).

### 3.1 Strategy menu

| Strategy | What | When to use | Cost |
|---|---|---|---|
| Fixed-size | Equal token windows + overlap | Baseline floor / homogeneous text | O(1), no model calls |
| Recursive | Split on separator hierarchy (¶→line→sentence) | Pragmatic default for ~80% of prose | Cheap; strong recall/cost |
| **Structural / hierarchical** *(default)* | Chunk along headings/sections/tables, keep H1>H2>H3 path, token-capped (Docling HybridChunker) | Structured enterprise docs: policies, SOPs, contracts, wikis | Cheap; needs clean layout |
| Semantic (embedding-boundary) | Cut where sentence-similarity drops | Narrative text with topic drift; high-value corpora | ~14x slower; validate lift |
| Sentence-window | Index one sentence, return ±k neighbors | Factoid QA needing a little context | Light |
| Parent-document (small-to-big) | Search small children, return larger parent | High-leverage general upgrade | Two-tier store |
| Proposition / atomic | LLM decomposes to atomic facts | Precision factual KBs / FAQ | Expensive index-time LLM |
| Late chunking | Whole-doc embedding pass, then pool per chunk | With a long-context embedding model | Index-time only, no per-chunk LLM |

### 3.2 Recommended default

**Structural / semantic (layout-first, two-stage):** (1) parse with Docling to isolate tables/
figures as their own chunks; (2) chunk text with structural/hierarchical splitting capped by
tokens (HybridChunker). This preserves the high-value tabular data enterprises query and beats any
single flat strategy [Docling; FloTorch]. **Layer parent-document retrieval on top** as the
low-risk quality upgrade (embed/search small children, feed larger parents to the LLM; cap
children-per-parent so top-K doesn't collapse to 1–2 parents).

Do **not** blindly default to pure semantic chunking — benchmarks (NAACL-2025 / FloTorch / Chroma)
repeatedly show it costs ~14x more while often only matching recursive at equal size. Reserve
semantic/proposition/RAPTOR-style for specific corpora after evaluation proves lift.

### 3.3 Default params (overridable per space)

- **Chunk size:** 512 tokens; **overlap:** 10–20% (50–100 tokens) — validated sweet spot.
- Query-type tuning: 128–256 tokens (factoid/lookup); 512–1024 (analytical/summarization);
  code = whole function, no overlap; legal = paragraph-level, one-sentence overlap.
- Retrieve **top-20** chunks (Anthropic found 20 > 5/10); assemble ~6–10 chunks / ~1,200–2,500
  tokens for generation with dedupe + must-include-top-chunk.

---

## 4. Retrieval

Retrieval is **composable per space** (`DECISIONS.md` §3a): a menu of modes, a shipped default
stack, and per-space feature governance over which modes are enabled.

### 4.1 Composable modes & when to use

| Mode | When to use |
|---|---|
| **Classic / BM25 (lexical)** | Exact literals: identifiers, error codes, quoted phrases, jargon (legal/API/logs). Always one leg of hybrid — cheap, catches what dense misses. |
| **Dense vector (ANN)** | Conversational/paraphrased/concept queries, large corpora, synonym-heavy content. Baseline recall layer. |
| **Hybrid + RRF** *(default fusion)* | Calibration-free default: run dense + BM25, merge by rank (`score = Σ 1/(k+rank)`, `k=60`). Reliably beats either leg (~7–15% recall/NDCG). Maintain the vector and BM25 indexes as **one logical unit** (any add/update/delete writes both) — a stale sparse index is the most common hybrid-search bug. |
| **Weighted / α fusion** | Only for corpora with a *known* query distribution (bias dense vs sparse). Needs score normalization + per-corpus tuning; brittle otherwise. |
| **Contextual retrieval** | Heterogeneous corpora where chunks lose meaning; index-time context blurb (§2.6). Pair with hybrid + rerank — gains compound. |
| **Query transforms** | Conversational rewriting (always, in multi-turn chat); HyDE (vocabulary-gap domains); step-back (over-narrow queries); decomposition/multi-query (multi-hop/comparative). Route by query type; skip HyDE/decomposition on latency-critical chat. |
| **Cross-encoder rerank** | High recall but low precision (right chunk at rank 7). Retrieve ~100–150 → rerank → keep top ~10–20. Fixes precision, not recall. (§6) |
| **GraphRAG** | Global "connect-the-dots" / sensemaking across a corpus ("top risks across all contracts"). Prefer **LazyGraphRAG** (index cost = vector RAG, ~700x cheaper queries than full GraphRAG at matching quality) [Microsoft]. |
| **RAPTOR** | Multi-hop / whole-document reasoning within long single docs, no explicit relations. ~10x cheaper to index than full GraphRAG [Stanford, ICLR 2024]. |
| **ColBERT / multi-vector (late interaction)** | High-QPS, tail-latency-sensitive precision; near cross-encoder quality at tens-of-ms. Budget the ~2–4x storage premium. |
| **SQL-RAG / text-to-SQL** | Structured/tabular data — "ask the spreadsheet". See §7 (privacy-preserving). |
| **Agentic (retrieve→reason→re-retrieve)** | Hard/multi-hop/ambiguous queries; gate behind a difficulty router with per-tenant iteration + token budgets. Corrective-RAG (retrieval-quality classifier + fallback) is the cheap first step. |

### 4.2 DEFAULT stack (v1)

Per `DECISIONS.md` §3a "Default stack":

```
markdown-first parse
  → semantic/structural chunking (§3.2)
  → contextual retrieval + hybrid (dense + BM25, RRF k=60)
  → cross-encoder rerank (C5 service, retrieve ~100–150 → top ~10–20)
  → grounded generation with citations (message_citations)
```

Conversational query rewriting is on for multi-turn chat. Generation is grounded: answers cite
retrieved chunks; a faithfulness/groundedness check runs inline (§8) and citations resolve to
source docs (with bbox evidence-pins where the parser preserved coordinates).

### 4.3 Ship-enabled vs feature-gated per space

- **Enabled by default:** BM25, dense, hybrid+RRF, contextual retrieval, cross-encoder rerank,
  conversational rewriting, grounded generation. This is the default stack — the safe baseline.
- **Feature-gated (advanced, per-space, off by default):** GraphRAG/LazyGraphRAG, RAPTOR,
  ColBERT/multi-vector, SQL-RAG, agentic retrieve→reason→re-retrieve, HyDE/step-back/decomposition.
  Enabled per space via 4-state feature governance (`DECISIONS.md` §4: workspace→space→role→user);
  members' Playground experiments are session-only, admins/space-owners set defaults.

Route by query type/difficulty rather than always-on for the expensive modes — most traffic is
factoid and shouldn't pay graph/agentic overhead.

---

## 5. Embedding

Embedding is a **chain-managed capability**, exactly like chat (`DECISIONS.md` §3 "capabilities are
chain-managed"). An **embedding chain** binds embedding-capable models and uses the same
fallback / circuit-breaker / per-step plane (local|cloud) machinery as chat chains.

- **Dimension: 1024**, to match `document_embeddings vector(1024)` (fix from `vector(384)`, §5).
- **Adapters:** desktop local = **embedded in-process** — `EmbeddedLlamaAdapter` (llama.cpp, GGUF
  embed model) or `OrtAdapter` (ONNX) — **no external Ollama daemon** (`DECISIONS.md` §3 "Local
  inference/embeddings"). Cloud embedding models are bound via the same chain for the cloud plane.
  `fastembed` is disabled — do not use it.
- **Capability is per-model, not per-provider** (`DECISIONS.md` §3): the chain step's behavior
  derives from its bound model's `model_capabilities` (embed). One adapter can serve a reasoning
  model to a chat chain and an embed model to an embedding chain.
- Sensitive datasets can pin embedding to the **local plane** so raw values never leave the device
  (§7). Model choice is operator config; 1024-dim is the fixed contract.

---

## 6. Reranking

Per `DECISIONS.md` §3, **rerank is a separate C5 service for v1** — the crate `TextRerank` is a
reserved `Unsupported` variant, and a `RerankModel` trait is a later optional gateway issue. So v1
implements reranking as a C5-owned service behind a **provider-agnostic interface** (self-hosted,
in-engine, or hosted API selectable per tenant/route).

- **Model choice (default):** self-host **BAAI/bge-reranker-v2-m3** (Apache-2.0, multilingual,
  ~50–100ms on GPU) for cost/latency control and data-residency (tenant chunks never leave the
  boundary). Offer Cohere Rerank / Voyage Rerank as zero-ops managed options for tenants who opt
  in. Avoid Jina reranker v2 base weights in the paid product (CC-BY-NC-4.0 — API only)
  [particula; futureagi].
- **Two-stage pattern:** retrieve wide (~100–150 candidates from hybrid) → rerank → keep top
  ~10–20. Reranking fixes precision, **not** recall — if first-stage `Recall@k_retrieve` is low,
  fix retrieval first.
- **Latency:** self-hosted BGE ~50–100ms (GPU); hosted APIs ~500–600ms incl. network for ~50
  candidates. For high-QPS tail-latency-sensitive routes, ColBERT-style late interaction is the
  precision-with-throughput alternative (§4.1).
- **Adaptive, not always-on:** fast mode (no rerank, strict metadata filters) as default for easy
  queries; deep mode (rerank + query rewrite, optionally LLM/listwise rerank) triggered by low
  retrieval confidence, high-risk intent, or explicit citation requests — keeps multi-tenant
  cost/latency bounded.

Gate every rerank deployment on the eval triangle (§8): NDCG@k_final, Recall@k pre-vs-post rerank
(guard against dropping needed docs), and p95/p99 latency. If NDCG is flat with rerank on, remove
it on that route.

---

## 7. Sensitive structured data (§3c) — compute without exposing

Per `DECISIONS.md` §3c: **the model sees the structure, not the values; the app does the math.**
This is the concrete, implementable v1 pattern (builds on SQL-RAG in §4).

1. **Structured datasets.** Ingest CSV/XLSX and tables extracted from docs (§2.2) as **queryable
   datasets** stored as JSON/CSV, with a **schema** (column names, types, descriptions, stats) and
   **column-level sensitivity** classification (`sensitive`/`restricted` columns: salary, SSN,
   account #, …). Multi-table spreadsheets are split into distinct logical tables first.
2. **Field-level encryption at rest.** Sensitive columns are **encrypted per-tenant (F3 DEK)**,
   decryptable only inside the trusted compute boundary (central gateway `service_role`, or the
   on-device plane for local-only data). Non-sensitive columns + aggregate stats stay queryable.
3. **Schema-to-LLM, execute-in-app** (FACTS/MaskSQL-class threat model): the LLM receives only the
   **pruned schema + non-sensitive metadata/samples/aggregates** — never raw sensitive rows. It
   emits a **computation plan** (text-to-SQL / filter / formula spec); the **app/gateway executes**
   it against the real data inside the trusted boundary and returns **only the derived,
   policy-gated result**. Optional tiering: a small local model detects + abstracts sensitive
   schema/values before a stronger model synthesizes SQL over placeholders (MaskSQL), keeping most
   frontier accuracy without exposing literals.
4. **Guardrail pipeline on every generated statement (fail-closed):** SQL AST parser (allow
   `SELECT` only; reject DDL/DML, multi-statement, dynamic SQL, stored procs, unresolved refs) →
   policy engine against the tenant catalog → execution containment (read-only role, statement
   timeout, row/cost caps) → output verification → structured audit log. Re-validate repaired
   queries; escalate high-risk/ambiguous to human review [DPRIVER].
5. **Aggregate / k-anonymity gating.** Population/analytics endpoints return **aggregates only**
   with a **minimum-group-size (k-anonymity) threshold** (suppress groups < k). No row-level
   sensitive values in the response; the result passes the **W5 redaction check** before reaching
   the model or user. (Differential privacy / format-preserving tokenization = later, per §3c.)
6. **Prefer the local plane** for sensitive data — pin datasets to on-device execution (local model
   + local compute) so raw values never leave the device; cloud steps receive only schema +
   computed results.
7. **Governance:** column sensitivity + allowed operations (aggregate-only, thresholds, which
   roles/spaces may compute) are space/admin policy (feature-governed). **Every compute is an audit
   + quality signal** (§8).

Schema linking (prune to the relevant tables/columns before generation) is both the top accuracy
lever on wide schemas and a data-minimization control (send less). Sandbox any Pandas/code
execution to prevent arbitrary code execution.

---

## 8. Evaluation & quality signals (§3b)

Per `DECISIONS.md` §3b, every interaction records quality signals to a `quality_signals` store
keyed to `inference_calls`/`messages`, streamed to the O1 audit ledger and rolled into O2
analytics. Retrieval/RAG metrics feed that store.

### 8.1 Metrics (layered, cheapest-first)

- **Retrieval IR (deterministic, no LLM):** **recall@k** (coverage / "is the answer even
  retrievable?"), precision@k, MRR, **nDCG@k** (ranking / rerank tuning). Track recall@k for the
  fed-to-LLM `k` plus a large recall@100 to see reranker headroom.
- **Context precision / context recall (RAGAS, reference-light LLM-judged):** **context recall is
  the canary** for the most common silent failure — partial retrieval + coherent generation while
  faithfulness stays high. Put it on the primary dashboard.
- **Faithfulness / groundedness (generation-side, primary safety metric):** decompose the answer
  into atomic claims, verify each against retrieved context (LLM-judge or NLI). Run **offline in CI
  and inline at inference** as a blocking/soft-flag guardrail; reuse the same evaluator template
  both places ("metric alignment"). Force + verify citations for high-stakes tenants.
- **Answer relevance / correctness:** catches off-topic/partial answers and (with references)
  factual agreement.
- **LLM-as-judge (with bias controls):** swap candidate order and average (position bias); prefer a
  panel of diverse smaller judges; explicit rubrics; validate judge↔human agreement with Cohen's
  kappa. **Never let the generator judge itself unblinded** (relevant since the gateway may route
  to the same model family for both roles). Treat scores as relative/trend signals (RAGAS ~0.55
  human correlation), not absolute SLAs [RAGAS; ARES].

### 8.2 Wiring into `quality_signals`

The default stack emits per call/message: retrieval recall/precision, rerank NDCG,
grounding/faithfulness score, LLM-judge quality score, cost, latency, fallbacks taken,
guardrail/policy hits (incl. W5 redactions and §7 compute events), and the "why this model" trace
(`DECISIONS.md` §3b "Signal capture"). These back the Playground/Ask **live meters** (grounding /
quality / cost / latency), the quality-judge toggle, and auto-tune-prompt (§3b "Live surfacing").

### 8.3 Continuous quality loop

Offline: run the metric suite on a **versioned test set** (human-golden + RAGAS/ARES synthetic +
production-mined failures) in CI; gate model/config swaps on regression thresholds. Online: emit
**OpenTelemetry** traces (query, retrieved chunks, rerank scores, agent trajectory, tokens,
latency, cost) — provider-agnostic per no-hardcoded-ops — run **sampled** LLM-judge scoring on live
traffic, alert on regressions + embedding drift, promote low-scoring traces back into the offline
suite. Test sets/traces contain tenant content → **segregate per tenant, access-control, anonymize
before promoting to shared suites**.

---

## 9. Storage & data-model touchpoints

Object storage (Supabase Storage / S3-style buckets), tenant/space-scoped, holds originals +
normalized artifacts (`DECISIONS.md` §3a). Originals and derived artifacts are **per-tenant
isolated and encrypted**. F1 tables (per §5 schema deltas):

| Table | Role in this design |
|---|---|
| `documents` | `+content_hash` (dedup) + lineage; `scope` (org/space/individual) + `owner_id` + `space_id`; `status` pipeline (§2.1) |
| `document_collections` | Collections/folders/tags |
| `document_versions` | Re-upload = new version; history kept; stale-chunk retirement on hash change |
| `document_assets` | Object-storage refs: originals (immutable, hash-addressed) + normalized md/CSV/extracted images + structured IR JSON |
| `document_embeddings` | `vector(1024)` (fix from 384), HNSW index; re-pointed to the space+classification ACL |
| **structured datasets** (§3c) | Dataset + per-column schema (name/type/desc/stats) + column sensitivity; field-level encryption for sensitive columns |
| `conversations` / `messages` / `message_citations` | Ask persistence; grounded answers cite retrieved chunks |
| `quality_signals` | Keyed to `inference_calls`/`messages` (§8) |
| `spaces` / `settings` | Per-space retrieval + chunking config (mode, weights, chunker, params, enabled advanced modes) |

**ACL:** space membership + fixed 4-level classification only (`public`/`internal`/`confidential`/
`restricted`); the recursive-ACL tables (`access_groups`/`group_levels`/`document_access`/
`user_accessible_documents`) are **retired** (`DECISIONS.md` §3). **Tenant isolation is enforced at
the index/namespace layer, not app code** — pair pgvector RLS with a hard per-tenant partition so a
query embedding cannot surface another tenant's neighbors [OWASP LLM 2025 #8]. Embeddings are
sensitive data: KMS-encrypted at rest + TLS, retrieval restricted to service accounts, bulk-pull
alerting, self-hosted vector store in-VPC for regulated tenants.

Collaborative-editing tables (comments/suggestions/`document_collaborators`) are **v2** — design-
only in v1, not in the v1 cut (`DECISIONS.md` §5 "Document center").

---

## 10. Playground surface (W3)

The Playground exposes the composable retrieval stack for interactive tuning + inspection
(`DECISIONS.md` §3a; canonical UI = `docs/mockups/app/*.jsx`). Members experiment session-only;
admins/space-owners set defaults.

- **Retrieval-mode selector** — pick modes (classic / dense / hybrid / +contextual / GraphRAG /
  RAPTOR / ColBERT / SQL-RAG / agentic); advanced modes appear per-space per feature governance.
- **Weight slider** — hybrid fusion balance (RRF default; α-weight for known distributions).
- **Rerank picker** — none / self-hosted BGE / hosted (Cohere/Voyage), per §6.
- **Chunking selector** — strategy + size/overlap (§3), previewed against the space's docs.
- **Retrieval inspector** — shows retrieved chunks with scores (dense / BM25 / fused / rerank),
  the "why this model"/chain trace, per-stage recall/precision, grounding + citation resolution,
  and cost/latency meters (backed by `quality_signals`, §8). Surfaces bbox evidence-pins.
- **Promote-to-space-default** — persist the current configuration to `spaces`/`settings` as the
  space default (feature-governed; admin/space-owner only).

Live meters (grounding / quality / cost / latency), quality-judge toggle, and auto-tune-prompt are
backed by the §8 signal store (`DECISIONS.md` §3b "Live surfacing").

---

## 11. Open questions + phased build order

### Open questions

1. **BM25/lexical index engine.** pgvector has no native BM25/rerank — do we add a lexical index
   (Postgres FTS / external) alongside pgvector, or adopt a store with native hybrid (Qdrant/
   Weaviate/Vespa)? Affects the "single logical unit" dual-write and in-engine rerank option.
2. **Rerank service topology.** In-process C5 service vs sidecar vs hosted API default — data-
   residency vs ops. (Interface is provider-agnostic regardless.)
3. **Contextual enrichment cost on churny corpora.** Default-on vs opt-in per space, given
   re-contextualization on every version change.
4. **C6 placement (§3b).** New C6 module owning the signals contract vs distributing across
   C4/O1/O2 — confirm in the module reconciliation (step 4).
5. **GraphRAG engine.** LazyGraphRAG (preferred) vs classic — build/index infra and per-tenant
   partitioning of the graph namespace.
6. **Structured-data execution engine.** Which sandboxed SQL/Pandas executor inside the trusted
   boundary; semantic/metrics-layer vs raw text-to-SQL for governed recurring questions.
7. **Multi-vector storage budget.** If ColBERT/ColPali ships, the ~2–4x per-tenant storage premium
   must be modeled into quota/billing.

### Phased build order

- **v1 — Default stack first.**
  1. Ingestion: Docling markdown-first + originals/IR/artifacts, table→CSV, image→caption, tiered
     OCR fallback; content-hash dedup + versioning/lineage; status pipeline.
  2. **Redact-at-rest (§2 W5)** before embedding — layered regex+entropy + NER, one-way
     placeholders; signals to `quality_signals`.
  3. Structural/semantic chunking (+ parent-document); embedding chain (1024-dim, embedded-local or
     cloud).
  4. Hybrid (dense+BM25, RRF) + contextual retrieval; **cross-encoder rerank C5 service**; grounded
     generation with citations.
  5. Sensitive structured data (§7): datasets + schema + field-level encryption + schema-to-LLM
     execute-in-app with guardrail pipeline + aggregate/k-anonymity gating.
  6. Evaluation + `quality_signals` wiring (§8); Playground selector + inspector +
     promote-to-default (§10).
- **v1 (feature-gated, per-space, off by default):** query transforms (HyDE/step-back/
  decomposition), GraphRAG/LazyGraphRAG, RAPTOR, ColBERT/multi-vector, agentic retrieve→reason→
  re-retrieve — enabled per space after per-corpus eval proves lift.
- **v2 (design-only screens in v1):** agent-driven collaborative editing runtime (comments/
  suggestions/chat-to-edit, X2); interaction-intelligence go-between (§3b); reversible un-redaction
  for authorized roles; richer structured-data privacy (DP, format-preserving tokenization);
  page-as-image visual retrieval (ColPali) for visually rich corpora.

---

### Sources (inline citations above)

- Anthropic — Contextual Retrieval (failure 5.7%→1.9%; top-20; $1.02/M tokens):
  https://www.anthropic.com/engineering/contextual-retrieval
- IBM Docling — layout-aware parsing + HybridChunker: https://research.ibm.com/blog/docling-generative-AI
- RRF / hybrid fusion (k=60): https://blog.serghei.pl/posts/reciprocal-rank-fusion-explained/
- ColBERTv2 / PLAID (late interaction): https://arxiv.org/pdf/2205.09707
- Microsoft LazyGraphRAG: https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/
- RAPTOR (Stanford, ICLR 2024): https://arxiv.org/pdf/2401.18059
- FACTS (schema-only threat model): https://arxiv.org/pdf/2510.13920
- MaskSQL (value/schema abstraction): https://arxiv.org/pdf/2509.23459
- DPRIVER — LLM SQL guardrail architecture: https://www.dpriver.com/blog/llm-sql-guard-architecture-parser-catalog-policy-engine-audit-log/
- RAGAS metrics: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/
- ARES: https://arxiv.org/pdf/2311.09476
- OWASP LLM 2025 #8 (Vector & Embedding Weaknesses) / embedding inversion:
  https://galileo.ai/blog/llm-embedding-security-risks-defenses
- Microsoft Presidio + GLiNER (PII detection): https://microsoft.github.io/presidio/samples/python/gliner/
- Reranker comparison (BGE/Cohere/Voyage/Jina, latency/NDCG/licensing):
  https://particula.tech/blog/reranker-models-compared-cohere-voyage-jina-bge-latency-ndcg
