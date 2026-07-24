# W3 · Playground & retrieval lab — Spec

**Module:** [W3](../modules/W3-playground.md) · **Plane:** Web (member Console + desktop) · **Status:** Planned — build-ready
**Depends on:** [W4](../modules/W4-design-system.md) (tokens/atoms), [C5](C5-rag-document-intelligence.md) (retrieval engine + inspector + per-space config), [C1](C1-gateway-service.md) (auth, `/v1/chat`+`/v1/compare`, gateway-mediated writes), [C6](C6-quality-signals.md) (`quality_signals`, meters, explicit-feedback RPC), [C4](C4-governance-runtime.md) (guardrail/redaction wrapper + feature governance), [F2](F2-identity-auth-rbac.md) (capabilities + JWT), [D2](../modules/D2-local-gateway.md) (desktop local plane) · **Enables:** space-owner retrieval defaults (persisted to C5), the "show-by-example" demonstration surface, quality-signal-backed live meters
**Date:** 2026-07-23 · **Framework:** Svelte 5 + Rokkit (per Phase 0) · **Design basis:** [`../design/rag-and-document-center.md`](../design/rag-and-document-center.md) §10 + [`../design/mockup-review.md`](../design/mockup-review.md) §E (items 22–24) / §G (26–27) / cycle-2 (32–33, 35–38) / cycle-3 (49, 51–53) · conforms to [`../DECISIONS.md`](../DECISIONS.md) §3a/§3b/§3c, §2 W1/W5, §4.

---

> W3 is a **pure client (Web) module**: it renders the ratified Playground surface and consumes
> upstream contracts (C5 retrieval, C6 signals/meters, C1 chat/compare + gateway-mediated writes).
> It **owns no F1 tables** and mints **no new capability**. `DECISIONS.md` is the single source of
> truth; the mockups under `docs/mockups/app/*.jsx` are the authoritative UI ground truth
> (canonical: `app/view-playground.jsx`, meter parity with `app/view-ask.jsx`). W3 does **not**
> invent screens beyond the ratified Playground route. **No-hardcoded-ops**
> ([`project-gateway-no-hardcoded-ops`]): the enabled-mode set, default config, rerank options,
> chunker params, and fusion weights are read from per-space config + feature governance — never
> baked into the client.

---

## 1. Purpose & scope

W3 is the **retrieval lab** — the "show by example" surface where a member or space-owner assembles
a retrieval pipeline layer-by-layer and watches every toggle visibly change the **trace**, the
**answer**, and the **live meters**. It is the interactive face of the C5 composable retrieval
stack (`DECISIONS.md` §3a) and the C6 quality-signal read model (§3b): the one place users can
compare retrieval modes, inspect what ran, judge quality, tune prompts, and (if authorized)
**promote a configuration to the space default**.

**In scope (the ratified Playground surface):**

- **Retrieval-mode selector** — the full §3a composable set selectable per space: classic/BM25 ·
  dense · hybrid fusion (+ **weight slider**) · contextual · query transforms (rewrite/HyDE/
  step-back/decompose) · GraphRAG · RAPTOR · ColBERT/multi-vector · SQL-RAG/text-to-SQL · agentic.
- **Rerank-model picker** — none / self-hosted BGE / hosted (Cohere/Voyage), per C5 §6 (rerank is a
  **C5 service**, not in-engine — GH-8).
- **Chunking-strategy selector** — strategy + size/overlap (C5 §3), previewed against the space's docs.
- **Retrieval inspector** — retrieved chunks with per-stage scores (dense / BM25 / fused / rerank),
  **dropped** candidates, per-stage `k_in/k_out` + timings + recall, grounding + citation resolution,
  and **bbox evidence-pins** (highlight-at-source). Backed by `quality_signals` (C6).
- **Live meters** — grounding / answer-quality / cost / latency (C6 read model).
- **Quality-judge toggle** (LLM-as-judge) and **auto-tune-prompt** (both feature-governed).
- **Model-compare (2–4)** — side-by-side model/pipeline runs with optional per-slot judge.
- **Promote-to-space-default** — gated (capability `retrieval.manage` + feature governance),
  gateway-mediated write; otherwise member experiments are **session-only**.
- **Local-vs-cloud indicator** — per-step execution-location badge (desktop), driven by the plane
  attribute (GH-1), not the provider name.

**Out of scope (owned elsewhere, referenced by W3):** the retrieval/rerank/embedding engine and the
`spaces`/`settings` retrieval config (C5); the `quality_signals` store, meter read model, and
explicit-feedback RPC (C6); grounded generation, `/v1/chat`/`/v1/compare`, and all privileged writes
(C1); the guardrail/redaction pipeline and the LLM-as-judge chain (C4/C5); dataset **management**
(schema view + column-sensitivity editor) which lives in W2 Library / Governance (C5 §3c) — W3 only
surfaces the SQL-RAG **compute** panel; the 4-state feature-governance authoring (O3/C4). W3 adds
**no screens** beyond the Playground route (model-compare is an inline mode, §8).

---

## 2. Responsibilities

1. Render the Playground route (member tool; some controls admin-gated) to the fidelity of
   `app/view-playground.jsx`, using W4 tokens/atoms.
2. Resolve, per active space, **which controls render enabled / locked / user-overridable** from the
   4-state feature governance (`DECISIONS.md` §4 precedence workspace→space→role→user) + the caller's
   capabilities (F2), and render locked controls with the lock + tooltip visual.
3. Hold **session-only** pipeline state (mode set, fusion weights, chunker + params, rerank model,
   toggles, top-k, query transforms) as client state — never persisted unless promoted.
4. Execute a run via C1 (`/v1/chat` scoped to the space + a session retrieval override; `/v1/compare`
   for model-compare), stream the grounded answer, and render the trace + answer + citations.
5. Populate the **retrieval inspector** from C5's `RetrieveResult` (per-stage scores, dropped
   candidates, stage timings, recall, grounding) and resolve each citation to its source chunk +
   **bbox evidence-pin**.
6. Render the **live meters** and the "why this model" trace from the C6 read model
   (`GET /v1/meters`), optionally subscribing to the RLS-scoped Realtime meter channel.
7. Capture **explicit feedback** (thumb/rating/accept/edit/retry/correction) via the C6
   gateway-mediated RPC (`POST /v1/signals/feedback`).
8. Toggle **quality-judge** and **auto-tune** (feature-governed) and surface their effects (judge
   score in the quality meter; the tuned prompt in the trace).
9. Perform **promote-to-space-default** through the gateway-mediated capability-checked write
   (C5 `POST /rpc/retrieval/set-config`, capability `retrieval.manage`) when authorized.
10. Surface the **§3c SQL-RAG compute** path (schema-to-LLM → execute-in-app) with the
    "computed in-app · values never sent to model" badge and aggregate/k-anon result rendering.
11. On desktop, run the pipeline on the **local plane** via D2 IPC (`c5_retrieve`,
    `c5_dataset_compute`) and reflect offline/local execution states.
12. Show the **redaction indicator** ("N items redacted") in the guardrails trace step (§2 W5),
    with placeholders (never raw secrets) in inspector chunk text.

Non-responsibilities: W3 does not retrieve/rerank/embed, does not enforce budgets or governance, does
not write `quality_signals`/`spaces`/`settings` directly (all via the gateway), and does not own the
judge chain or dataset schema editors.

---

## 3. Data model (F1 tables — used, none owned)

W3 owns **no** schema. It reads through gateway endpoints (RLS/service-role mediated) and performs
only two gateway-mediated writes (promote-config, explicit-feedback). Session pipeline config is
**client-only state** (in-memory + optional `localStorage`), never an F1 row unless promoted.

| Table | Owner | W3 use |
|---|---|---|
| `spaces` / `settings` | F1 / C5 / W1 | **Read** the per-space retrieval + chunking config (`GET /v1/spaces/:id/retrieval-config`) as the baseline the session forks from; **write** only via the gateway-mediated promote (`PUT …/retrieval-config`, capability `retrieval.manage`). |
| `feature_states` / `user_preferences` | C4 / O3 | **Read** (RLS-scoped) to resolve the 4-state governance for each advanced mode + toggle (enabled/locked/default-on/-off/user-overridable), per §4 precedence. Determines which controls render locked. |
| `document_embeddings` / `documents` / `document_assets` | C5 | **Read indirectly** via the C5 retrieve/inspector payload (chunk text, `section_path`, `page_ref`, `bbox`, `element_type`) — for the inspector rows and the bbox evidence-pin. Never queried directly by W3; always through C5 under the space+classification ACL. |
| `quality_signals` | C6 (F1 store) | **Read** via the C6 meter read model (`GET /v1/meters`, `GET /v1/signals`); **write** explicit signals only via `POST /v1/signals/feedback` (service-role-mediated; `actor_id` server-bound). Never direct PostgREST. |
| `inference_calls` | C1 (ledger) | **Read** (via `GET /v1/meters`) for cost/latency/served-model/plane. Every Playground run — including a **session-only experiment** — is a real metered row (§8.1). |
| `conversations` / `messages` / `message_citations` | C1/C4 | The subject of feedback signals + citation resolution; a Playground run may persist a `messages` row when the user saves the exchange (otherwise session-scoped). |
| `datasets` / `dataset_columns` | C5 (§3c) | **Read** the non-sensitive schema/aggregates surfaced by the SQL-RAG compute panel; the sensitivity editor itself lives in W2/Governance, not W3. |

**Retired / never used:** the group-ACL tables (`access_groups`/`group_levels`/`document_access`/
`profile_groups`/`user_accessible_documents`) — ACL is space membership + fixed 4-level
classification only (`DECISIONS.md` §3).

---

## 4. Contracts

W3 is a browser/Tauri client. Its "contracts" are (a) the upstream HTTP/IPC endpoints it consumes,
(b) the typed client config model it forks/serializes, and (c) the events it subscribes to. All HTTP
rides the C1 auth boundary (RS256/JWKS JWT or `api_keys`).

### 4.1 The session config model (client-side, TypeScript)

Mirrors the per-space retrieval/chunking config JSON persisted on `spaces`/`settings` (C5 §3.2, §9).
A **session** forks the space baseline; only a `promote` persists it.

```ts
interface RetrievalConfig {                 // == the JSON shape on spaces/settings (C5)
  modes: {                                   // §3a composable set
    classic: boolean; dense: boolean; hybrid: boolean; contextual: boolean;
    graphrag?: boolean; raptor?: boolean; colbert?: boolean;
    sqlrag?: boolean; agentic?: boolean;     // advanced → feature-gated
  };
  fusion: { method: 'rrf' | 'alpha'; rrf_k?: number; alpha?: number };   // weight slider
  chunking: {
    strategy: 'fixed' | 'recursive' | 'structural' | 'semantic'
            | 'sentence_window' | 'parent' | 'proposition' | 'late';
    size: number; overlap: number;
  };
  rerank: { provider: 'none' | 'bge' | 'cohere' | 'voyage'; model?: string };  // C5 §6
  top_k: number;
  query_transforms: { rewrite: boolean; hyde: boolean; step_back: boolean; decompose: boolean };
  judge: boolean;                            // quality-judge toggle
  autotune: boolean;                         // auto-tune prompt
}

interface PlaygroundSession {
  space_id: string;
  base_config: RetrievalConfig;              // from GET …/retrieval-config
  override: Partial<RetrievalConfig>;        // session-only diff (never persisted)
  model?: string;                            // pinned model (single-run) — within allow-list
  compare?: string[];                        // 2–4 model ids for model-compare mode
  session_only: true;                        // always true until promoted
}

interface GovernanceState {                  // resolved 4-state per control (§4 precedence)
  [control: string]: 'locked' | 'default-on' | 'default-off' | 'user-overridable';
}
```

### 4.2 HTTP consumed (central plane)

Retrieval + inspector (**C5**):
```
GET  /v1/spaces/:space_id/retrieval-config        → RetrievalConfig (baseline; capability SELECT)
POST /v1/spaces/:space_id/retrieve                 # inspector data (retrieval-only tuning)
  req { query, top_k?, config_override?, inspect:true, session_only:true }
  res { chunks:[{chunk_id, document_id, text, section_path, page_ref, bbox,
                 scores:{dense,bm25,fused,rerank}, dropped:bool}],
        stages:[{name, k_in, k_out, recall_at_k?, ms}], grounding_ready, config_used, redactions }
PUT  /v1/spaces/:space_id/retrieval-config         # PROMOTE-to-default (gateway-mediated,
                                                   #   capability `retrieval.manage`) — §5
```

Run + grounded answer (**C1**):
```
POST /v1/chat  (+ /v1/chat/stream, SSE)
  req { messages, system?, model|chain, space_id,
        retrieval_override?: Partial<RetrievalConfig>,   # session-only, NON-persisted — see note
        inspect?: bool, conversation_id? }
  res { content, model, adapter, usage, cost_usd, execution_location,
        inference_call_id, trace_id,
        inspector?: RetrieveResult }                     # present when inspect:true
POST /v1/compare
  req { messages, models:[2..4], space_id, retrieval_override?, mode:'panel' }
  res { compare_group_id, slots:[{ model, content, inference_call_id, cost_usd,
                                   execution_location, trace_id }] }
```

> **Required C1 contract addition (flag for C1 reconciliation).** For a retrieval-lab run to change
> the *answer* per the session config, C1 `/v1/chat`/`/v1/compare` MUST accept a session
> `retrieval_override` (a non-persisted `Partial<RetrievalConfig>`) + `inspect`, forwarding them to
> the C5 retrieve step and returning the `RetrieveResult` inspector block in the response/`done`
> event. This is the **preferred single-call** path (avoids a double retrieve). If C1 does not adopt
> it, W3 falls back to composing two calls: C5 `/retrieve` (inspector) then C1 `/v1/chat`
> (generation over the returned chunk context). See §11 open question 1.

Meters + feedback (**C6**):
```
GET  /v1/meters?message_id=… | inference_call_id=…   → { grounding, quality, cost, latency,
                                                          why_model, fallbacks, guardrail_hits,
                                                          redaction_hits }
GET  /v1/signals?inference_call_id=… | message_id=…  → { signals: QualitySignal[] }   # inspector/debug
POST /v1/signals/feedback                             # explicit signal (actor_id server-bound, W5-redacted)
  req { inference_call_id?|message_id?, key:'rating'|'thumb'|'accept'|'edit'|'retry'|'correction',
        value_num?, value_text?, value_json? }         → 201 { signal_id }
```

§3c SQL-RAG compute (**C5**):
```
POST /v1/datasets/:id/compute
  req { question, plane_pin? }
  res { plan:{sql|formula}, result:<aggregate/derived only>, k_anon_ok, suppressed_groups,
        redactions, executed_plane:'local'|'cloud' }
```

Governance/whoami resolution (**C1/F2**): `GET /v1/whoami` → `{ capabilities[], device_status, … }`
to decide `retrieval.manage` gating; the 4-state `GovernanceState` is resolved from
`feature_states`/`settings`/`user_preferences` (RLS SELECT or a governance resolver — §11 Q2).

### 4.3 Tauri IPC consumed (desktop local plane, via D2)

Sensitive datasets and local-only spaces run entirely on-device; commands mirror the HTTP shapes and
never egress raw values (C5 §4.2):
```
c5_retrieve(space_id, query, config_override?)  -> RetrieveResult    # local index, inspector data
c5_dataset_compute(dataset_id, question)        -> ComputeResult      # local model + local exec
```
Grounded generation on desktop is orchestrated by the D2 local gateway (D3 split-plane), which
surfaces the same `inference_call_id` + per-step `plane` for the ExecBadge and meters.

### 4.4 Events subscribed

- **Live-meter Realtime channel** (C6) — RLS-scoped to the caller's tenant/conversation; streams
  meter updates during a run so grounding/quality/cost/latency animate live. Optional; polling
  `GET /v1/meters` is the fallback.
- **Ingestion-status** is **not** a W3 concern (that is W2 Library); W3 assumes a `ready` index.

---

## 5. Security & RLS

- **No new capability; `retrieval.manage` gates promote.** W3 mints nothing. **Promote-to-space-
  default** is a privileged write to `spaces`/`settings` and is **gateway-mediated** (C5
  `PUT …/retrieval-config`, capability `retrieval.manage` — a C5-requested addition to the F2
  canonical set). A caller without it sees the promote control rendered **locked** (lock + tooltip);
  a direct attempt is rejected `403` and `spaces`/`settings` is unchanged (`DECISIONS.md` §2 W1).
- **Session experiments are read-only w.r.t. config.** A member's session `retrieval_override` is
  passed per-request and **never** persisted; it cannot mutate `spaces`/`settings`. The only client
  state is in-browser. This closes any "member silently changes the space default" path.
- **Tenant + space + classification isolation (inherited).** All retrieval, inspector, dataset, and
  meter reads flow through C5/C6 under `tenant_id = (auth.jwt()->>'tenant_id')::uuid` composed with
  space membership + the fixed 4-level classification predicate. A Playground user can only retrieve
  within spaces they belong to; the inspector shows only chunks they can access; cross-tenant recall
  is 0 (C5 §5, OWASP LLM 2025 #8 per-tenant vector partition). W3 renders whatever C5 returns — it
  performs no independent access decision.
- **Secrets & redaction (§2 W5, first-class here).** Retrieved chunk text is already **redacted at
  rest** (C5 ingestion, one-way placeholders v1) and passes the **C4 redact-in-flight** pass before
  egress; therefore the inspector and answer render **placeholders, never raw secrets/PII**. The
  guardrails trace step shows a **"N items redacted"** chip (mockup items 27/36). Explicit
  `correction`/`edit` feedback the user types is run through the **C4 in-flight redaction** by the
  C6 RPC before store (`value_json` is W5-clean — counts/placeholders only). W3 must not log raw
  prompt/answer/chunk content to the console or telemetry.
- **Explicit-feedback actor binding.** `POST /v1/signals/feedback` binds `actor_id = auth.uid()`
  server-side (never client-supplied); a member cannot forge a signal for another user or rate a
  cross-tenant/inaccessible subject (`403`) — same rule as `audit_events` (C6 §5).
- **Device-status on the hot path.** Runs, compare, feedback, and meter reads ride the C1 hot path
  where the per-request device-status check applies (a revoked device with a live JWT cannot keep
  running Playground calls), per `DECISIONS.md` §2 apply-without-asking.
- **Feature-governed toggles.** Quality-judge, auto-tune, and each advanced retrieval mode render
  per the resolved 4-state governance (§4). `locked` controls are non-interactive; `default-off`
  controls are toggleable only where the resolution allows a session/user override; the resolution
  is enforced server-side too (C5 rejects a mode not enabled for the space) — W3's locking is UX,
  not the security boundary.
- **Budget applies to experiments.** Because every run is a real metered inference call (§8.1), the
  C1 reserve→commit against the caller's budget node applies; a member out of headroom on a `hard`
  node is blocked (`402`) even in the Playground (budget cannot be bypassed, `DECISIONS.md` §2 W2).

---

## 6. Key flows (numbered)

1. **Open Playground.** Load the active space → `GET /v1/spaces/:id/retrieval-config` (baseline) +
   resolve `GovernanceState` (which modes/toggles are enabled/locked/overridable, §4) + `whoami`
   capabilities → render the mode selector, weight slider, rerank picker, chunking selector, and
   toggles, with governed controls locked.
2. **Configure a session pipeline.** User picks modes, drags the hybrid **weight slider**, chooses a
   **rerank model**, sets the **chunking strategy + size/overlap**, and flips judge/auto-tune/
   guardrails/citations/retention. All mutate the client-only `PlaygroundSession.override`.
3. **Run a single query.** `POST /v1/chat/stream` with `{ space_id, model, retrieval_override,
   inspect:true }` (preferred single call, §4.2 note) → C1 runs C5 retrieve (session config) + C4
   guardrails/redaction + grounded generation → stream the answer + citations; response carries
   `inference_call_id` + `inspector`. ExecBadge shows the served step's **plane** (local|cloud,
   GH-1). Meters populate from `GET /v1/meters?inference_call_id=…` (or the Realtime channel).
4. **Inspect what ran.** Expand the inspector → render per-chunk **dense / BM25 / fused / rerank**
   scores, **dropped** candidates, per-stage `k_in/k_out` + timings + recall, grounding, and the
   config actually used; each **citation resolves** to a source chunk and (where the parser
   preserved coordinates) highlights a **bbox evidence-pin** in the preview (mockup item 51).
5. **Quality-judge.** Toggle on (feature-governed) → C4/C5 issue the judge as a **separate metered
   inference call** (its own `inference_calls` row + budget reserve) whose `implicit.judge_score`
   attaches to the run's subject → the **Answer-quality** meter shows the judge score (C6 §6.3).
6. **Model-compare (2–4).** Select 2–4 models → `POST /v1/compare` (mode=panel) with the shared
   session config → render answers side-by-side, each with its own meters + ExecBadge + optional
   per-slot judge; each slot persists an `inference_calls` row sharing `compare_group_id` (C1 §6.4,
   C6 §6.7). Inline mode within the Playground route (§8), not a separate screen.
7. **Explicit feedback.** User clicks thumb/rating/accept/edit/retry/correction on an answer →
   `POST /v1/signals/feedback` with the subject `inference_call_id`/`message_id` → C6 binds
   `actor_id`, redacts any `value_json` (W5), writes via service-role → the signal appears in the
   inspector and rolls into O2.
8. **Promote-to-space-default.** An admin/space-owner with `retrieval.manage` clicks Promote →
   `POST /rpc/retrieval/set-config` (gateway-mediated, capability-checked) → persisted to
   `spaces`/`settings`; an `audit_events` row is emitted. A subsequent `GET /v1/spaces/:id/retrieval-config`
   returns the new default. Members without the capability see the control locked.
9. **Session-only experiment lifecycle.** A member's runs execute as real metered `inference_calls`
   (budget reserved), but the config is **never persisted** and the emitted `quality_signals` are
   tagged **experiment/ephemeral** (short retention) so they are **excluded from the space's
   production O2 quality rollups** (§8.1). Nothing touches `spaces`/`settings`.
10. **SQL-RAG / sensitive structured data (§3c).** In SQL-RAG mode the "ask the data" panel calls
    `POST /v1/datasets/:id/compute` → the inspector shows the generated **plan (SQL)** + the
    **aggregate/k-anon-gated result** + a **"computed in-app · values never sent to the model"**
    badge; suppressed low-group results show `suppressed_groups`. Sensitive datasets pin local
    (`executed_plane='local'`). Dataset **management** (schema/sensitivity editor) is W2/Governance.
11. **Desktop local plane.** On desktop, steps 3–4 and 10 run via D2 IPC (`c5_retrieve`,
    `c5_dataset_compute`) entirely on-device; ExecBadge shows "ran on your device"; the offline
    banner appears when cloud is unreachable and cloud-only modes/models are gated.
12. **Save / load a session.** The client Sessions + shared Templates affordances
    (`view-playground.jsx`) save/restore a `PlaygroundSession` client-side (mockup Sessions/Templates
    stores); server-side shared session persistence is deferred (§11 Q4).

---

## 7. Gateway-crate dependencies (+ GH-issue refs)

W3 is a client; it never links the `sensei-*` crates directly — it consumes engine behavior only via
C1/C5/C6/D2. Relevant issues in [`../plans/gateway-issues.md`](../plans/gateway-issues.md):

- **GH-1 (per-step `plane` + execution-location on the trace) — relevant.** The Playground ExecBadge
  and the inspector's per-step local/cloud badges (mockup items 38, 49) depend on the trace exposing
  per-step `plane`. Until GH-1 lands, the badge degrades to a single served-model plane. **Fixes the
  mockup's provider-keyed badge** (`route==='Ollama'`) → driven by the plane column.
- **GH-8 (`TextRerank` = `Unsupported`) — relevant, not blocking.** The rerank-model picker's options
  (none/BGE/Cohere/Voyage) are provided by the **C5 rerank service** (`RerankProvider`), not the
  crate; v1 does not block on a `RerankModel` gateway trait.
- **GH-6 (streaming-safe redaction hook) — relevant to streamed runs.** Accurate `redaction_hits` on
  a streamed answer (and the inspector redaction chip) depend on C4 redacting streamed output; else
  C4 buffers-then-redacts. W3 consumes whatever count C4 reports.
- **GH-7 (MCP / tool-calling) — relevant to SQL-RAG + the tools allow-list rail.** The Playground
  tools allow-list panel and SQL-RAG-as-tool routing reflect the C1-enforced per-(role×space) MCP
  allow-list (X1); W3 renders granted/blocked state, it does not enforce.

**No new gateway-repo issue** is introduced by W3 — it is a pure consumer of GH-1/GH-6/GH-7/GH-8
(already filed for C1/C4/C5/D3).

---

## 8. Decisions resolved

Settling the W3-seed and C6/§3.4 residuals per the DEFAULTS.

1. **Session-only experiments are real metered `inference_calls`; their `quality_signals` are
   experiment-tagged + short-retention and excluded from the space's production O2 rollups.**
   *Rationale:* a Playground run hits the engine and costs real money, so budget **cannot** be
   bypassed — the C1 reserve→commit against the caller's node applies (`DECISIONS.md` §2 W2), hence a
   real ledger row. But experiments must not pollute the space's default-quality analytics, so the
   emitted signals carry an `experiment`/session flag (C6 §3.4 retention flag) that O2 excludes from
   the space-default quality panels. This resolves the W3-seed and C6 §10 open question: **metered,
   but analytically segregated** — not fully ephemeral (would bypass budget), not fully counted
   (would skew defaults).
2. **Model-compare is an inline Playground mode, not a separate screen (v1).** *Rationale:* it reuses
   the exact session pipeline config and the same C1 `/v1/compare` panel path; `DECISIONS.md` §6 /
   mockup item 10 lean "Playground control + optional dedicated screen." A dedicated Compare screen
   is deferred (§11 Q5).
3. **Promote-to-space-default is a gateway-mediated capability-checked write (C5
   `PUT …/retrieval-config`, `retrieval.manage`), never a direct client write.** *Rationale:*
   per-space retrieval config is a privileged field on `spaces`/`settings` (`DECISIONS.md` §2 W1);
   members are SELECT-only on it. The control renders locked without the capability.
4. **Advanced modes + judge/auto-tune render per resolved 4-state feature governance
   (workspace→space→role→user); session overrides never persist and are re-validated server-side.**
   *Rationale:* §4 governance + §2 W1 — the UI lock is convenience, the server (C5) is the boundary.
5. **The quality-judge is a separate metered call owned by C4/C5; W3 only toggles it and renders the
   score.** *Rationale:* judging is itself inference (budget + ledger apply); model/prompt/cost-budget
   selection is a C4/C5 chain concern (C6 §8). W3 stays free of model-selection policy.
6. **ExecBadge is driven by the per-step `plane` (local|cloud), not the provider/route name.**
   *Rationale:* capability-is-a-model-attribute (`DECISIONS.md` §3); fixes mockup item 49 — the badge
   reads the plane column (GH-1), so an Ollama-over-HTTP cloud step correctly shows "cloud."
7. **W3 owns no F1 tables and mints no capability.** *Rationale:* it is a presentation module over
   C5/C6/C1 contracts; adding tables/capabilities here would duplicate ownership and drift.
8. **The SQL-RAG panel surfaces §3c compute only; dataset schema + column-sensitivity editing lives
   in W2 Library / Governance.** *Rationale:* keeps the retrieval lab focused; the sensitivity
   classification is an admin/space-owner governance act (C5 §3c, mockup items 35/52), not a member
   experiment.

---

## 9. Acceptance criteria (observable, testable)

**Retrieval controls change the trace/answer/meters**
- Selecting **hybrid** and dragging the **weight slider** changes the `fused` scores and the chunk
  order shown in the inspector for the same query (observable diff between two slider positions).
- Changing the **chunking strategy/size** re-runs retrieval with the new params; the inspector shows
  a different chunk set — and a subsequent `GET …/retrieval-config` confirms `spaces`/`settings` is
  **unchanged** (session-only).
- The **rerank picker**: BGE vs none changes the `rerank` scores + the dropped set in the inspector;
  `none` removes the rerank stage from `stages[]`.

**Inspector**
- `inspect:true` yields per-chunk `dense`/`bm25`/`fused`/`rerank` scores, `dropped` candidates,
  per-stage `k_in`/`k_out` + timings, grounding, and the `config_used`; a citation resolves to a real
  chunk and (where `bbox` exists) highlights an evidence-pin in the preview.

**Governance + authorization**
- An advanced mode `locked`/`default-off` for the space renders non-interactive (lock + tooltip) and
  cannot be run; enabling it via feature governance makes it selectable without a code change
  (no-hardcoded-ops).
- **Promote:** an admin with `retrieval.manage` persists the config (subsequent `GET` returns it +
  an `audit_events` row exists); a member without it sees the control locked, and a direct
  `PUT …/retrieval-config` returns `403` with `spaces`/`settings` unchanged.

**Metering + analytics segregation**
- A member's **session experiment** run creates exactly one `inference_calls` row per model
  (metered; budget reserved), does **not** change `spaces`/`settings`, and its `quality_signals` are
  excluded from the space's O2 default-quality panel (experiment-tagged).
- With a `hard` budget node at cap, a Playground run is rejected `402` (budget not bypassed).

**Judge + compare**
- Quality-judge on → the Answer-quality meter shows a `judge_score` **and** a separate judge
  `inference_calls` row exists (metered).
- Model-compare with 3 models → three answers side-by-side, three `inference_calls` rows sharing one
  `compare_group_id`, each with its own meters + ExecBadge.

**Feedback + redaction (§2 W5)**
- Clicking thumb/rating writes a `quality_signals` row via `/v1/signals/feedback` with
  `actor_id = auth.uid()` (server-bound); a `correction` containing a secret is stored as a
  **placeholder**, not the raw value.
- A run over a document with redacted content shows an **"N items redacted"** chip and the inspector
  chunk text contains **placeholders, never raw secrets/PII**.

**Execution location + desktop**
- The ExecBadge reflects the served step's **plane** (a local step shows "ran on your device"), not
  the provider name.
- On desktop offline, retrieval + local generation still run (via D2 IPC), the ExecBadge shows local,
  the offline banner appears, and cloud-only modes/models are gated.

**§3c**
- SQL-RAG "ask the data" on a dataset with a `sensitive` column returns an **aggregate** result with
  **no raw sensitive value**, shows the "computed in-app · values never sent to model" badge, and a
  below-threshold group is suppressed (`suppressed_groups > 0`); a `plane_pin='local'` dataset shows
  `executed_plane='local'`.

**No-hardcoded-ops**
- The enabled-mode set, default config, rerank options, and chunker params are read from
  `spaces`/`settings` + feature governance (changing a space's config changes the Playground UI with
  no client code change).

---

## 10. Reuse / source

- **Canonical UI:** `docs/mockups/app/view-playground.jsx` (pipeline layers + inspector + meters);
  meter parity with `app/view-ask.jsx` (grounding/quality/cost/latency + "why this model"). The
  `docs/mockups/components/pg-rag.jsx` / `pg-ask.jsx` / `tweaks-panel.jsx` are the **W5 marketing**
  showcase versions — **reference-only**, not canonical.
- **Mockup gaps to resolve (designer handoff, `design/mockup-review.md`):** the current mockup ships
  only 4 "pipeline layers" (raw/sentence/content/SQL) + on/off rerank; W3 requires the expanded
  §E surface — items **22** (mode selector + weight slider + rerank picker + chunking selector),
  **23** (inspector with recall@k/context-precision + quality-judge), **24** (promote-to-default +
  local-vs-cloud indicator), **32** (hybrid slider, standalone rerank picker, chunking selector,
  promote, model-compare 2–4, inspector), **33** (space-settings governed-defaults entry), **35/52**
  (§3c compute panel + badge), **26/27/36** (quality meters + redaction chip), **49** (plane-driven
  ExecBadge), **51** (bbox evidence-pin), **53** (v2 interaction-intelligence surfaces, design-only).
- **Framework:** Svelte 5 + Rokkit atoms (W4); tokens port from `app/zs.css` named vocabulary (blocked
  on the W4 token map + dark palette, mockup item 42).

---

## 11. Open questions (genuine)

1. **Single-call vs two-call inspector path.** Does C1 `/v1/chat`/`/v1/compare` adopt the
   `retrieval_override` (session-only) + `inspect` fields (preferred single call, §4.2 note), or does
   W3 compose C5 `/retrieve` + C1 `/v1/chat`? The single-call path avoids a double retrieve and keeps
   the answer consistent with the session config; it is a small C1 contract addition to confirm.
2. **How the resolved 4-state `GovernanceState` reaches the client.** A dedicated resolver endpoint
   (`GET /v1/features?space_id=`) vs client-side resolution over RLS-scoped
   `feature_states`/`settings`/`user_preferences` SELECTs (precedence workspace→space→role→user). The
   resolver is cleaner and avoids re-implementing precedence in TS; owned jointly with O3/C4.
3. **Weight-slider semantics under RRF default.** RRF is rank-based and calibration-free; a weight
   slider implies α-weighted fusion (needs score normalization + per-corpus tuning, brittle per C5
   §4.1). Does the slider switch fusion to `alpha` mode, and is member session α-tuning allowed or
   admin-only? (Affects `RetrievalConfig.fusion`.)
4. **Server-side session persistence.** Can a `PlaygroundSession` be saved/shared server-side (the
   `prompt_templates` table exists in F1) or is it client-only (current mockup Sessions store)? If
   server-side, is a session config a `prompt_templates` variant or a new artifact?
5. **Dedicated Compare screen.** §8 settles model-compare as an inline mode for v1; confirm a
   dedicated Compare screen is not needed before v1 ships (mockup item 10 leaves this open to the
   designer).
