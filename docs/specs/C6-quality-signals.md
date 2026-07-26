# C6 · Quality signals & interaction intelligence — Spec

**Module:** [C6](../modules/C6-quality-signals.md) · **Plane:** Central (C-plane, in the request path) · **Status:** Planned
**Depends on:** F1 (schema), C1 (gateway hot path + `GatewayStore`), C4 (governance trace + LLM-as-judge), C5 (retrieval metrics) · **Enables:** O1 (audit ledger), O2 (analytics), W2/W3 (live meters, judge, auto-tune)
**Date:** 2026-07-23 · **Authoritative record:** [`../DECISIONS.md`](../DECISIONS.md) §3b (+ §3a/§3c signal feeds) · **Schema:** [`F1-data-model.md`](./F1-data-model.md)

---

> **Module confirmed (DECISIONS §3b "confirm in step 4").** C6 is ratified as a **standalone module** owning the quality-signal contract and (v2) the interaction-intelligence go-between — **not** distributed across C4/O1/O2. Rationale in §8. The `quality_signals` store lives in the **F1 schema** (owned conceptually by C6, `service_role`-write), audit lands in **O1**, analytics rollups in **O2**. The `modules/README.md` edges `{ C1, C4 } → C6 → O1, O2` (line 47) are correct and load-bearing; C6 is module 23.

---

## 1. Purpose & scope

Define the **single quality-signal contract** for Torii: the canonical set of signals captured on every interaction (call / message), how they are captured (from the C4 governance wrapper, the engine trace, and C5 retrieval/eval), where they are persisted (`quality_signals` in F1), and how they flow to audit (O1), analytics (O2), and the live meters (W2/W3). C6 is the **one place** that owns *what a quality signal is* so that capture points, meters, dashboards, and (v2) the optimizer all agree on one schema.

Two tiers, per DECISIONS §3b:

- **v1 — signal capture, audit, live meters, judge/auto-tune toggles.** Every inference call and message records **explicit** (human) and **implicit/system** signals; they stream to the immutable audit ledger (O1) and roll into analytics (O2); the Playground/Ask live meters (grounding / quality / cost / latency), the quality-judge toggle, and auto-tune-prompt are backed by this store.
- **v2 — the interaction-intelligence go-between.** An adaptive optimizer that sits between the user and the gateway and improves conversations in-flight (query rewrite/decompose/HyDE, clarifying questions, learned preferences, prompt auto-tuning, model-selection tuning). **Agent-adjacent** (aligns with X2 agents = design-only v1 / runtime v2): **surfaces are designed in v1; the adaptive runtime ships with X2 in v2.** This spec fixes the v1 contract so the v2 optimizer has a stable read model.

**Depends-on:** F1 (owns the `quality_signals` DDL + RLS), C1 (hot path where signals are emitted + `GatewayStore` writes the ledger), C4 (governance/redaction trace + LLM-as-judge result), C5 (retrieval precision/recall/grounding inputs). **Enables:** O1 (streams signals into the immutable audit ledger), O2 (rolls signals into analytics), W2 (Ask meters + feedback controls), W3 (Playground meters, inspector, judge, auto-tune, model-compare).

**Out of scope here:** the DDL column-by-column (F1 implementation plan / `F1-rework-plan.md` RW7-adjacent); the LLM-as-judge *prompt/model* selection (C4/C5 own the judge chain); the audit-integrity and SIEM mechanics (O1); the analytics rollup materialized views (O2). C6 owns the **contract + capture orchestration + read model**, not those consumers' internals.

---

## 2. Responsibilities

- **Own the quality-signal contract** — the canonical, versioned, namespaced signal taxonomy (explicit vs implicit/system, type, value shape, source, unit), stable across new detectors and meters. This is C6's authoritative artifact; O1/O2/W2/W3/(v2)optimizer reference it.
- **Persist signals** to the `quality_signals` store (F1, `service_role`-write) keyed to `inference_calls` and/or `messages`, tenant-scoped.
- **Orchestrate capture** at the C1/C4 hot path: collect explicit signals (client-submitted, gateway-validated) and implicit signals (from the engine trace, C4 governance result, C5 retrieval metrics, and the LLM-as-judge result) and write them as one batch per call/message.
- **Expose a read model** for the live meters (grounding / quality / cost / latency), the "why this model" surface, and the retrieval inspector — computed from `quality_signals` + the `inference_calls` trace, tenant/RLS-scoped, low-latency.
- **Stream to O1** (each signal is an audit-eligible event on the immutable ledger) and **feed O2** (analytics rollups: quality, grounding, judge-score, guardrail/redaction-hit rate).
- **(v2)** Run the adaptive **go-between mediator** that consumes signal history + a user/LLM-response model to improve conversations in-flight. v1 designs the surfaces only.

Non-responsibilities: C6 does **not** enforce budgets (C3), route (C2), redact (C4), embed/retrieve (C5), or own the audit-immutability/SIEM guarantees (O1) or analytics math (O2). It defines the signal shape and gets signals written; the consumers own their side.

---

## 3. Data model (F1 tables owned/used)

### 3.1 Owned (conceptually) — `quality_signals` (F1, new in the §5 rework cut)

Lives in the F1 schema (`public`/`app`), added in the 2026-07-23 rework (DECISIONS §5: "add `quality_signals` (§3b, keyed to `inference_calls`/`messages`)"). `service_role`-write only; tenant-scoped SELECT under RLS. One row per (signal, subject).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `tenant_id` | `uuid` NOT NULL | RLS key; composite FK `(tenant_id, …)` |
| `inference_call_id` | `uuid` NULL | FK → `inference_calls.id` (the ledger row; the primary key). Nullable so a message-level or conversation-level signal can exist without a call. |
| `message_id` | `uuid` NULL | FK → `messages.id` (Ask thread turn, RW5). At least one of `inference_call_id`/`message_id` MUST be non-null (CHECK). |
| `conversation_id` | `uuid` NULL | Denormalized FK → `conversations.id` for cheap thread rollups. |
| `signal_key` | `text` NOT NULL | Canonical namespaced key from §3.3 (e.g. `explicit.rating`, `implicit.grounding`). CHECK against the versioned enum/domain. |
| `signal_class` | `text` NOT NULL | `explicit` \| `implicit` (a.k.a. system). CHECK. Redundant-but-indexed derivation of the key namespace, for fast filtering. |
| `value_num` | `double precision` NULL | Numeric value (score 0–1 / 0–100, cost, latency ms, count). |
| `value_text` | `text` NULL | Categorical/enum value (e.g. `accept`/`edit`/`retry`, model id for `why_model`). |
| `value_json` | `jsonb` NULL | Structured payload (e.g. redaction hit spans-count by detector, retrieved-chunk scores, judge rubric breakdown). Never stores raw secret/PII content — counts/placeholders only (W5). |
| `unit` | `text` NULL | `ratio` \| `percent` \| `usd` \| `ms` \| `count` \| `bool` \| `label`. |
| `source` | `text` NOT NULL | Provenance: `user` \| `governance` (C4) \| `engine` (trace/GH-1) \| `retrieval` (C5) \| `judge` (LLM-as-judge) \| `system`. CHECK. |
| `actor_id` | `uuid` NULL | For `explicit` signals: the submitting user (`auth.uid()`-bound on the client-facing RPC, W5/O1 audit-integrity rule). Null for system signals. |
| `schema_version` | `int` NOT NULL DEFAULT 1 | Contract version (§3.3); lets new detectors/meters coexist. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | Capture time. |

Indexes: `(tenant_id, inference_call_id)`, `(tenant_id, message_id)`, `(tenant_id, signal_key, created_at)`, `(tenant_id, conversation_id)`. Retention: see §3.4.

### 3.2 Used (read; owned elsewhere)

- **`inference_calls`** (F1, single `service_role`-only ledger — DECISIONS §3; F1-rework RW7). The subject anchor for implicit signals. C6 reads its cost/latency/served-model/route/plane/`execution_location`/"why-this-model" trace fields (org→dept→team→user attribution, GH-5) to compute meters. C6 does **not** write `inference_calls` — C1's `GatewayStore` does. Cost & latency signals are read *from* the ledger, not re-stored, except where a meter needs them denormalized into `quality_signals` for a single-table read.
- **`messages` / `conversations` / `message_citations`** (F1, RW5). Subject anchor for message-scoped explicit signals (rating/edit/retry on a turn) and grounding/citation-derived signals. `message_citations` (message → document/chunk + score) is the input for retrieval-precision/recall signals.
- **`documents` / `document_embeddings`** (read indirectly via `message_citations` for grounding).
- The engine trace (`ChainEntry`/`Attempt`/`ExecutionTrace` from the `sensei-*` crates) — the runtime source of `implicit.fallbacks`, `implicit.why_model`, and per-step `plane`/`execution_location` (**GH-1**). Not an F1 table; surfaced through the ledger row C1 persists.

No new F1 table beyond `quality_signals` is required by C6. The go-between's learned-preference store (v2) is deferred and will reuse/extend `user_preferences` (F1, RW6) plus a v2 signal-history read model — not built in v1.

### 3.3 The signal contract (canonical, versioned — `schema_version` 1)

Namespaced keys. Adding a key bumps `schema_version` (additive; existing rows keep their version). Consumers filter by `signal_class` + `signal_key`.

**Explicit (source `user`; `actor_id` bound):**

| `signal_key` | value | unit | Capture point |
|---|---|---|---|
| `explicit.rating` | 1–5 (`value_num`) | `label`/`ratio` | W2 Ask / W3 Playground feedback control |
| `explicit.thumb` | `up`/`down` (`value_text`) | `label` | Ask/Playground thumb |
| `explicit.accept` | `bool` | `bool` | user accepted the answer/draft |
| `explicit.edit` | edit-distance or `bool` (`value_num`/`value_json`) | `ratio`/`bool` | user edited the answer/draft |
| `explicit.retry` | `bool` / retry-count | `bool`/`count` | user regenerated |
| `explicit.correction` | correction payload (`value_json`, redacted) | `label` | user-supplied correction (feeds v2 learning) |

**Implicit / system:**

| `signal_key` | source | value | unit |
|---|---|---|---|
| `implicit.grounding` | retrieval/governance | grounding score | `percent` |
| `implicit.retrieval_precision` | retrieval (C5) | precision@k | `ratio` |
| `implicit.retrieval_recall` | retrieval (C5) | recall@k | `ratio` |
| `implicit.judge_score` | judge (LLM-as-judge) | quality score + rubric (`value_num` + `value_json`) | `percent` |
| `implicit.cost` | engine (ledger) | metered cost | `usd` |
| `implicit.latency` | engine (ledger) | wall-clock | `ms` |
| `implicit.fallbacks` | engine (trace) | fallback steps taken (`value_num` + `value_json` chain) | `count` |
| `implicit.guardrail_hit` | governance (C4) | hits by policy (`value_num` + `value_json`) | `count` |
| `implicit.redaction_hit` | governance (C4, W5) | secret/PII redactions by detector (`value_num` + `value_json`, **counts/placeholders only**) | `count` |
| `implicit.why_model` | engine (trace) | served model + reason chain (`value_text` + `value_json`) | `label` |
| `implicit.sensitive_compute` | governance (C4, §3c) | schema-to-LLM compute occurred + gate applied (`value_json`) | `label` |
| `implicit.classification_applied` | governance (C4) | masking/classification enforced (`value_json`) | `label` |

The contract is published as a Rust module + a JSON descriptor (§4) so all consumers share one source of truth.

### 3.4 Retention

Signals inherit the O1 audit-retention policy (per-artifact retention window, O1 open question) since every signal is an audit-eligible event. Default v1: **`quality_signals` rows are retained as long as their subject `inference_call`/`message`** (co-terminous); O2 keeps derived rollups beyond raw-signal expiry. `value_json` payloads MUST never contain raw secret/PII (only redaction *counts*/detector labels/placeholders), so retention carries no leak risk (W5). Session-only Playground experiments (W3) may write **ephemeral** signals flagged for short retention — see §10 open question.

---

## 4. Contracts

C6 has no public UI of its own; it exposes (a) a Rust signal-contract crate/module used by C1/C4/C5, (b) capture RPCs on the C1 gateway-mediated write path for explicit signals, (c) a read-model query for meters, and (d) an internal write API used by the C4 wrapper.

### 4.1 Rust — the signal contract (shared library)

Published in the Torii gateway service (`services/gateway`) and consumed by C1/C4/C5 capture points.

```rust
/// Canonical namespaced signal key (schema_version 1). Adding a variant bumps the version.
pub enum SignalKey {
    // explicit
    Rating, Thumb, Accept, Edit, Retry, Correction,
    // implicit / system
    Grounding, RetrievalPrecision, RetrievalRecall, JudgeScore,
    Cost, Latency, Fallbacks, GuardrailHit, RedactionHit,
    WhyModel, SensitiveCompute, ClassificationApplied,
}

pub enum SignalClass { Explicit, Implicit }
pub enum SignalSource { User, Governance, Engine, Retrieval, Judge, System }

pub struct QualitySignal {
    pub tenant_id: Uuid,
    pub inference_call_id: Option<Uuid>,
    pub message_id: Option<Uuid>,
    pub conversation_id: Option<Uuid>,
    pub key: SignalKey,
    pub class: SignalClass,
    pub source: SignalSource,
    pub value_num: Option<f64>,
    pub value_text: Option<String>,
    pub value_json: Option<serde_json::Value>, // MUST be W5-clean (counts/placeholders, no raw secret/PII)
    pub unit: Option<Unit>,
    pub actor_id: Option<Uuid>,                 // required for Explicit
    pub schema_version: i32,                    // = 1
}

/// Batched writer — one call per interaction; service_role only. Also fans out to O1 (audit) and O2 (rollup).
#[async_trait]
pub trait QualitySignalSink {
    async fn record(&self, signals: Vec<QualitySignal>) -> Result<(), SignalError>;
}
```

- The contract crate exports a JSON descriptor (`quality-signals.v1.json`) for the web read model (W2/W3) and O2 dashboards so TS clients don't hardcode keys.
- `QualitySignalSink::record` is called **once per call/message** by the C4 wrapper (implicit + judge) and by the explicit RPC (§4.2). It validates `actor_id` presence for `Explicit`, CHECKs the key against `schema_version`, rejects any `value_json` failing the W5 clean-payload assertion, and writes via `service_role` (§5).

### 4.2 HTTP — explicit-signal capture (C1 gateway-mediated write path)

Explicit signals are client-originated → they go through the **C1 domain RPC** (DECISIONS: gateway-mediated writes; per-domain, capability-checked), never a direct PostgREST insert into `quality_signals` (which is `service_role`-write-only).

```
POST /v1/signals/feedback           # submit an explicit signal on a call or message
  Authorization: Bearer <supabase-jwt | api-key>
  {
    "inference_call_id"?: uuid,
    "message_id"?: uuid,             # at least one of the two required
    "key": "rating" | "thumb" | "accept" | "edit" | "retry" | "correction",
    "value_num"?: number,
    "value_text"?: string,
    "value_json"?: object            # correction/edit payload; server redacts (W5) before store
  }
  → 201 { "signal_id": uuid }
     Server sets tenant_id + actor_id = auth.uid() from the verified JWT (not client-supplied),
     verifies the subject call/message belongs to the caller's tenant (and, for a message,
     that the caller owns/can-access the conversation), runs the value_json through the
     W5 redaction check, then writes via service_role.
  → 403 if the subject is cross-tenant or the caller can't access it
  → 422 on unknown key / bad value shape for schema_version
```

```
GET /v1/signals?inference_call_id=…| message_id=… | conversation_id=…
  → 200 { "signals": QualitySignal[] }   # tenant/RLS-scoped read model; for inspector/debug
```

```
GET /v1/meters?message_id=… | inference_call_id=…
  → 200 {
      "grounding": { "value": 86, "unit": "percent", "tone": "success" },
      "quality":   { "value": 91, "unit": "percent" },   # judge_score or heuristic
      "cost":      { "value": 0.0041, "unit": "usd" },
      "latency":   { "value": 540, "unit": "ms" },
      "why_model": { "served": "sonnet-4.6", "reasons": [...] },
      "fallbacks": 0, "guardrail_hits": 0, "redaction_hits": 2
    }
  # Backs the W2 Ask + W3 Playground live meters and the "why this model" panel. Read-only, RLS-scoped.
```

The explicit-feedback RPC requires **no special capability** beyond authenticated tenant membership and access to the subject (feedback on your own interaction). No capability from the F2 canonical set is minted for C6 in v1.

### 4.3 Internal — implicit-signal emission (C4 wrapper, in-process)

The C4 governance wrapper around `execute` / `execute_stream` is the single implicit-signal emission point. After a call completes (or a stream finishes/aborts), C4 assembles the implicit batch and calls `QualitySignalSink::record`:

1. From the **engine trace** (`Attempt`/`ExecutionTrace`, incl. GH-1 per-step `plane`/`execution_location`): `implicit.why_model`, `implicit.fallbacks`, `implicit.latency`.
2. From the **ledger row** C1 persisted: `implicit.cost` (+ latency if not from trace).
3. From the **C4 governance result**: `implicit.guardrail_hit`, `implicit.redaction_hit` (W5, counts only), `implicit.classification_applied`, `implicit.sensitive_compute` (§3c).
4. From **C5**: `implicit.grounding`, `implicit.retrieval_precision`, `implicit.retrieval_recall` (via `message_citations` scores).
5. From the **LLM-as-judge** (when the judge toggle is on): `implicit.judge_score` — note the judge is **itself a metered inference call** (its own `inference_calls` row + budget reserve), and its result attaches to the *judged* call's subject.

### 4.4 Events

- **To O1:** every persisted signal is emitted as an audit-eligible event on the immutable ledger (O1 owns the SIEM stream + immutability). C6 does not re-implement audit; it hands O1 the signal via the same `record` fan-out.
- **To O2:** signal writes trigger O2's rollup path (materialized views / rollup tables); C6 exposes the raw `quality_signals` + the contract descriptor, O2 owns aggregation.
- **Realtime (live meters):** the W2/W3 meters may subscribe to a Supabase Realtime channel scoped by RLS to the caller's tenant/conversation for streaming meter updates during a call (channels are RLS-scoped per DECISIONS §2 apply-without-asking).

---

## 5. Security & RLS

- **Store lockdown (W1).** `quality_signals` is **`service_role`-write-only**: `anon`/`authenticated` have `INSERT`/`UPDATE`/`DELETE` **REVOKED**. All writes go through the C6 sink (C4 wrapper for implicit; the `/v1/signals/feedback` RPC for explicit), which uses the service role. No direct PostgREST write.
- **Tenant isolation.** RLS SELECT policy `tenant_id = (auth.jwt()->>'tenant_id')::uuid` on `quality_signals`; message-scoped signals are further narrowed to conversations the caller owns/can access (matching `messages`/`conversations` RLS, RW5). Cross-tenant read returns 0 rows (F1 negative-test harness RW12 extends to `quality_signals`).
- **Authz via capabilities.** Reading your own interaction's signals/meters needs only authenticated tenant membership + subject access — no special capability. Writing an explicit signal is a self-owned benign write mediated by the RPC (server binds `actor_id = auth.uid()`, so a member cannot forge a signal attributed to another user — the same actor-binding rule as `audit_events`, DECISIONS §2). C6 mints **no new capability** in v1; it references the F2-owned canonical set (analytics/audit viewing gated by O1/O2's `governance.manage`/analytics-view capabilities where those screens require it).
- **Secrets & redaction (W5 — first-class here).** Signals frequently *describe* redaction/guardrail hits. The store MUST **never hold raw secret/PII**: `value_json` carries only **counts, detector labels, span offsets/lengths, and one-way placeholders** — no captured secret material, no reversible mapping (v1 = one-way placeholders only, DECISIONS §2 W5 / §5). The `QualitySignalSink::record` implementation asserts payloads are W5-clean and rejects otherwise. Explicit `correction`/`edit` payloads submitted by users pass through the **C4 in-flight redaction** before store. Because signals stream to O1 (SIEM) and O2 (analytics), a leak here would propagate widely — hence the hard clean-payload gate.
- **Device-status on the hot path.** Explicit-signal submission and meter reads ride the C1 hot path where the per-request device-status check applies (a revoked device with a live JWT cannot keep writing signals), consistent with DECISIONS §2 apply-without-asking.
- **Immutability.** `quality_signals` is append-only from the client's perspective (no client UPDATE/DELETE); corrections are new rows, not mutations. O1's immutability guarantee covers the streamed copy.

---

## 6. Key flows

1. **Implicit capture on a normal call (v1).** Client → C1 `/v1/chat` → C4 wrapper runs guardrails/redaction around the engine `execute` → engine returns answer + trace → C1's `GatewayStore` writes the `inference_calls` ledger row (cost, served model, plane/`execution_location`, why-model trace) → C4 assembles the implicit batch (grounding, retrieval precision/recall, cost, latency, fallbacks, guardrail/redaction hits, why-model, classification) → `QualitySignalSink::record` writes `quality_signals` (service_role), fans out to O1 (audit) + O2 (rollup) → W2/W3 meters read `/v1/meters`.
2. **Streaming call.** Same as (1) but C4 wraps `execute_stream`; implicit signals are finalized when the stream completes or aborts (redaction on streamed output may require the GH-6 stream-transform hook — else buffer-then-redact). Latency = time-to-last-token; partial/aborted streams still emit signals with an `aborted` marker in `implicit.why_model.value_json`.
3. **LLM-as-judge (quality-judge toggle on).** After (1), if the judge feature is enabled (feature-governed, W3/W2 toggle), C4 issues the judge as its **own metered inference call** (its own ledger row + budget reserve/commit, C3) → parses the rubric → records `implicit.judge_score` on the *original* subject call/message. Judge model/prompt/cost-budget are owned by C4/C5 (see §10).
4. **Explicit feedback (v1).** User clicks thumb/rating/accept/edit/retry/correction in W2 Ask or W3 Playground → `POST /v1/signals/feedback` with the subject id → C1 verifies tenant + subject access, binds `actor_id = auth.uid()`, redacts any `value_json` (W5), writes via service_role → row appears in the inspector and rolls into O2.
5. **Live meters + inspector (v1).** W3 Playground / W2 Ask call `/v1/meters` (and optionally subscribe to the RLS-scoped Realtime channel) → render Grounding / Answer-quality / Cost-per-query / Latency meters + the retrieval inspector (retrieved chunks + scores from `message_citations` + `implicit.retrieval_*`) + the "why this model" panel from `implicit.why_model`.
6. **Governance / redaction / sensitive-compute signals.** C4 masking, grounded-only enforcement, W5 redaction, and §3c sensitive-structured-data computes each emit their `implicit.*` signal (counts/labels only) in the same batch as (1) — making every governance action an auditable quality signal (DECISIONS §3b).
7. **Model-compare (W3).** 2–4 pipelines run as separate calls → each gets its own subject + signals + optional judge score → W3 renders them side-by-side from the read model; session-only experiment runs may be flagged ephemeral (§10).
8. **(v2) Interaction-intelligence go-between.** Between user and gateway, the optimizer reads signal history + learned preferences → rewrites/decomposes the query (HyDE), asks clarifying questions, tunes the prompt and model selection in-flight, then the optimized request flows through C4/C2/C1 as usual; its decisions themselves emit signals (a v2 `SignalKey` extension, `schema_version` 2). **v1 designs these surfaces only; runtime ships with X2.**

---

## 7. Gateway-crate dependencies

Engine = the six `sensei-*` crates @ **`v0.4.6`** (`kernel`, `gateway`, `cloud-providers`, `local-engine`, `local-providers`, `kokoro`). C6 consumes the crate only **indirectly** through C1/C4 — it reads the trace those modules surface; it does not wrap `execute` itself.

- **GH-1 (per-step `plane` + execution-location on the trace) — BLOCKING for full fidelity.** `implicit.why_model`, `implicit.fallbacks`, and the plane/`execution_location` attribution on signals depend on the crate exposing per-step `plane` on `ChainEntry` and execution-location on `Attempt`/`ExecutionTrace`. Until GH-1 lands, `implicit.why_model` degrades to served-model + reason without per-step plane. Sequenced before the C2/D3 phase; C6 rides that.
- **GH-5 (`inference_calls` ledger shape) — relevant.** C6's cost/latency/attribution signals read the ledger's org→dept→team→user attribution columns + rollup shape (GH-5). C6 does not write the ledger; it depends on C1's `GatewayStore` doing so.
- **GH-6 (streaming-safe governance/redaction hook) — relevant to flow 2.** Redacting streamed output before egress (and thus emitting accurate `implicit.redaction_hit` for streams) may need the crate's stream-transform interception point; otherwise the C4 wrapper buffers-then-redacts. C6 consumes whatever C4 produces.

No **new** gateway-repo issue is required by C6 — it is a pure consumer of GH-1/GH-5/GH-6 (already filed for C2/D3/O1/C4). If, in v2, the go-between needs an in-engine pre-request hook, a new issue would be filed then (out of v1 scope).

---

## 8. Decisions resolved

- **C6 is a standalone module (not distributed across C4/O1/O2).** *Rationale:* the signal taxonomy is a single cross-cutting contract consumed by ≥5 modules (O1, O2, W2, W3, and v2 X2). Distributing "what a signal is" across three consumers guarantees drift (each would define its own keys/units). One owning module with a versioned contract + a single `QualitySignalSink` write path keeps capture, meters, audit, and analytics in lockstep, and gives the v2 optimizer one stable read model. C6 stays thin (contract + orchestration + read model) — it does not duplicate C4 enforcement, O1 immutability, or O2 math. Confirms DECISIONS §3b default and the `modules/README.md` `{C1,C4}→C6→O1,O2` edges (module 23).
- **`quality_signals` lives in the F1 schema, owned conceptually by C6.** *Rationale:* it is tenant-scoped relational data keyed to `inference_calls`/`messages` and must share F1's RLS/tenant model, dbd workflow, and the `service_role`-write posture; F1 owns all DDL (RW cut) while C6 owns the *contract* the columns encode. No separate store.
- **`service_role`-write, no new capability.** *Rationale:* implicit signals are gateway-emitted; explicit signals are self-owned benign writes mediated by the C1 RPC with `actor_id = auth.uid()` binding (matching `audit_events`). Reading your own signals needs only tenant membership + subject access, so C6 mints no capability — it references F2's canonical set (analytics/audit screens gate via O1/O2 capabilities). Keeps the JWT bounded (server-side authz).
- **One-way placeholders only in signal payloads (v1).** *Rationale:* signals describing redaction/guardrail hits stream to SIEM (O1) and analytics (O2); storing raw secret/PII would create a wide leak surface. Per DECISIONS §2 W5 / §5, v1 stores counts/detector-labels/placeholders only, no reversible mapping. `QualitySignalSink` hard-rejects non-clean payloads.
- **Cost/latency are read from `inference_calls`, denormalized into signals only for single-table meter reads.** *Rationale:* the ledger (GH-5) is the source of truth for cost/latency (DECISIONS §3 one-ledger); duplicating them as signals is a read-optimization for the meter path, not a second source — analytics (O2) reads the ledger for authoritative cost, signals for quality.
- **The LLM-as-judge is a metered call owned by C4/C5; C6 only records its score.** *Rationale:* judging is itself inference (budget + ledger apply); C6's contract carries `implicit.judge_score`, but the judge model/prompt/cost-budget selection is a C4/C5 chain concern (feature-governed toggle in W2/W3). Keeps C6 free of model-selection policy.
- **Explicit feedback UI is v1 scope for C6's contract even where the current Ask mockup lacks the control.** *Rationale:* DECISIONS §3b lists rating/thumb/accept/edit/retry/correction as v1 capture points; the contract + RPC ship in v1. The missing Ask-side feedback control is a **mockup gap** (below) for the designer handoff (DECISIONS §6), not a scope cut.
- **Go-between optimizer is v2 (X2-runtime); v1 designs surfaces only.** *Rationale:* it is agent-adjacent and depends on the mature signal history this spec establishes; shipping the v1 contract is the prerequisite. No v1 runtime, no v1 optimizer tables (learned prefs reuse `user_preferences` in v2).

---

## 9. Acceptance criteria (observable, testable)

1. **Store + RLS.** `quality_signals` exists in the F1 schema with RLS enabled; `authenticated`/`anon` `INSERT`/`UPDATE`/`DELETE` are REVOKED; a tenant-scoped SELECT returns only own-tenant rows and cross-tenant read returns **0 rows** (extends the RW12 harness). A member cannot write `quality_signals` via PostgREST.
2. **Implicit capture.** After a `/v1/chat` call, `quality_signals` contains one row each for `implicit.cost`, `implicit.latency`, `implicit.grounding`, `implicit.why_model`, and (when applicable) `implicit.fallbacks` / `implicit.guardrail_hit` / `implicit.redaction_hit`, all keyed to the call's `inference_call_id` and tenant, `source` set correctly, `schema_version = 1`.
3. **Explicit capture + actor binding.** `POST /v1/signals/feedback` with a valid subject writes a row with `actor_id = auth.uid()` (server-bound, not client-supplied); a request that supplies a different `actor_id` or a cross-tenant/inaccessible subject is rejected (403) and writes nothing.
4. **Meters read model.** `GET /v1/meters?message_id=…` returns grounding/quality/cost/latency/why-model derived from `quality_signals` + the ledger for the subject, RLS-scoped; values match what W3 Playground renders for the same call.
5. **W5 clean-payload gate.** Submitting an `explicit.correction`/`edit` (or an implicit payload) containing a detectable secret/PII string results in the stored `value_json` containing a **placeholder, not the raw value**; `QualitySignalSink::record` rejects a payload that fails the clean-payload assertion.
6. **Judge score.** With the quality-judge toggle on, a judged call produces an `implicit.judge_score` row on the original subject **and** a separate `inference_calls` ledger row for the judge call itself (metered).
7. **Fan-out.** Each persisted signal appears in the O1 audit stream (immutable; no client UPDATE/DELETE) and is included in an O2 rollup (quality / grounding / judge-score / guardrail-hit-rate); disabling C6 capture makes those O2 quality panels empty (proving the dependency).
8. **Contract stability.** The published `quality-signals.v1.json` descriptor enumerates every key/class/unit in §3.3; a client using it renders meters without hardcoding keys; adding a key bumps `schema_version` without breaking existing rows (old rows keep version 1, still readable).
9. **Streaming.** A streamed `/v1/chat` call emits the same implicit signal set on completion; an aborted stream still emits signals marked `aborted`.
10. **No new capability leaked into the JWT.** The JWT is unchanged by C6; explicit-feedback authz is enforced server-side by tenant + subject-access checks, verified by a negative test (member of tenant A cannot rate tenant B's call).

---

## 10. Open questions

- **LLM-as-judge model / prompt / cost budget.** Which chain-bound model judges, the rubric prompt, and the per-tenant cost budget for judging (judging is itself a metered call). Owned jointly with C4/C5; needs a default judge chain + a governance toggle. *(Carried from the C6 seed.)*
- **Session-only Playground experiments.** How W3 session-only experiment runs surface in `quality_signals` — logged as real `inference_calls` (counted/metered) vs ephemeral short-retention signals. Affects the retention flag in §3.4 and O2 counting. *(Carried from W3.)*
- **Signal-schema versioning cadence.** Policy for when a new detector/meter bumps `schema_version` vs adds an additive optional key at the same version; how O2 rollups handle mixed versions over a window.
- **v2 go-between placement in the request path.** Where the adaptive optimizer sits relative to C4 governance and C2 routing (before guardrails? between rewrite and route?) and what new `SignalKey`s (schema_version 2) its in-flight decisions emit. Design-only in v1; resolved when X2 runtime is planned.
