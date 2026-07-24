# C4 · Governance runtime — Spec

**Module:** [C4](../modules/C4-governance-runtime.md) · **Plane:** Central (+ shared into the desktop local plane, D2) · **Status:** Planned · **Depends on:** F1, F2, C1 · **Enables:** O1 (audit), C6 (quality signals), C5 (redact-at-rest), X1 (tool-egress redaction), W1/W2/W3 (governance editor + trace panels)
**Date:** 2026-07-23 · **Engine crates:** `sensei-*` @ `v0.4.6` (`sensei-gateway`, `sensei-kernel`) — **consumed around** `execute`/`execute_stream`, **no in-engine hook**
**Authority:** conforms to [`../DECISIONS.md`](../DECISIONS.md) (§2 W1/W5, §3, §3b, §3c, §4). Where this spec and any other doc disagree, DECISIONS wins.

---

> ⚠️ **Framing correction (2026-07-23).** Earlier module notes described C4 as *"inline guardrails"* inside the request. That is wrong. The `sensei-*` engine (`v0.4.6`) exposes **no in-request governance hook** (confirmed — GH-6). C4 is a **consumer-side wrapper** that runs the guardrail pipeline **around** `execute`/`execute_stream`: transform the request **before** the engine call, transform the response **after** it, and for streams apply a token-buffered windowed transform over the SSE output. Governance is orchestration code owned by Strategos, not an engine plug-in.

---

## 1. Purpose & scope

C4 is the **policy runtime** for every inference and tool interaction. It enforces the security-and-trust posture that makes the gateway safe to point at cloud models: it **redacts secrets/credentials and PII (DLP, §2 W5)** before anything egresses, enforces **document classification + space ACL**, enforces **grounded-only** answering, filters **prompt-injection/jailbreak**, guards **sensitive structured data** (§3c), resolves **4-state feature governance**, assembles the **"why this model" trace**, and emits **audit events** (O1) + **quality signals** (C6) for every guard it applies.

C4 is not a network service of its own. It is a **shared Rust library** (`crates/governance` in the monorepo) invoked at three W5 enforcement points by three callers:

| Enforcement point | Caller | What C4 does |
|---|---|---|
| **Ingestion (redact-at-rest)** | C5 | Redact secrets/PII in normalized markdown **before embedding**, so the vector store never holds raw secrets. |
| **Inference (pre-send + post-receive)** | C1 (central) and D2 (desktop local gateway) | Guard the prompt/retrieved-context/agent messages before egress; guard the model output after receipt; stream-safe redaction on `execute_stream`. |
| **Tool egress** | X1 | Redact MCP tool **inputs** before send and **outputs** before they re-enter the model. |

**In scope:** the guardrail pipeline + detectors, the governance policy model (feature 4-state + masking/classification/retention/redaction settings), the classification/ACL enforcement, grounded-only enforcement, the sensitive-structured-data guard, the "why this model" trace, audit + quality-signal emission, and the gateway-mediated policy-editor backend.

**Out of scope:** the ledger/audit storage + SIEM streaming (O1), the quality-signal store schema + analytics (C6/O2), retrieval/chunking/embedding and the redaction-mapping store lifecycle (C5), MCP registry + allow-list resolution (X1 — C4 only redacts the I/O), JWT verification + capability resolution + the write authz endpoint plumbing (C1/F2), and the credential vault (F3).

**Depends on:** F1 (tables), F2 (capability set + JWT claims), C1 (the wrapper's host + the gateway-mediated write path). **Enables:** O1, C6, C5, X1, W1/W2/W3.

---

## 2. Responsibilities

1. **Wrap `execute`/`execute_stream` consumer-side** — run the ordered guardrail pipeline around each engine call (no in-engine hook, §3).
2. **Secret/credential + PII redaction (DLP, §2 W5)** — the headline guardrail, applied at all three enforcement points, using **vetted detector libraries** (high-recall secret scanners = published rulesets + entropy; PII classifiers), **not hand-rolled regex**. **One-way placeholders in v1** — no reversible mapping store.
3. **Streaming-safe redaction** — token-buffered sliding window so a secret/PII span spanning token boundaries is caught before egress (GH-6).
4. **Classification enforcement** — fixed 4-level scheme (`public`/`internal`/`confidential`/`restricted`) + space membership; mask/drop retrieved context above the caller's clearance. Group-ACL is retired.
5. **Grounded-only enforcement** — when enabled, answers must cite retrieved context; ungrounded output is blocked or annotated per policy.
6. **Prompt-injection / jailbreak filtering** on inbound prompts and on retrieved/tool content (indirect injection).
7. **Sensitive-structured-data guard (§3c)** — the model sees schema + non-sensitive metadata only; the app executes the computation plan inside the trusted boundary; the derived result passes the W5 redaction check before it reaches the model or user.
8. **"Why this model" trace** — assemble the budget-check → fallback → guards → served narrative from the engine's `ChainEntry`/`Attempt`/`ExecutionTrace` (per-step `plane`/execution-location needs GH-1).
9. **4-state feature governance** — resolve `locked | default-on | default-off | user-overridable` with precedence **workspace → space → role → user**.
10. **Audit + quality signals** — emit an `audit_events` row (O1) and a `quality_signals` row (C6) for every guard/redaction/policy hit.
11. **Policy-editor backend** — serve admin/space-owner edits to masking, classification display labels (relabel only), retention, and per-space redaction/DLP settings, through the C1 gateway-mediated write path (capability `governance.manage`).

---

## 3. Data model (F1 tables owned / used)

C4 owns **no new tables of its own**; it reads governance/knowledge tables and writes (as `service_role`, via C1) the audit + quality-signal + policy tables that O1/C6/F1 define. All references are to the reworked F1 (see [`F1-data-model.md`](./F1-data-model.md) and [`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md)).

### Writes (as `service_role`, gateway-mediated §2 W1)
- **`audit_events`** (O1; RW8) — append-only. C4 is the primary emitter. INSERT binds `actor_id = auth.uid()` for user-attributed events or is `service_role`-only for gateway-emitted events; UPDATE/DELETE denied. C4 records config changes, access, exports, sign-ins, policy/guardrail hits, **and every redaction event**.
- **`quality_signals`** (C6; F1 §5 delta) — keyed to `inference_calls` / `messages`, `service_role`-write. C4 writes the **implicit/system** signals it produces: redaction hits (counts by type), classification actions, grounded-only outcome + grounding score, jailbreak/injection hits, sensitive-data-compute events, and the "why this model" trace reference.
- **`settings`** (F1; workspace + space scope) — the policy-editor backend writes governance policy here: masking config, classification **display labels** (relabel only — the set is fixed, §4), retention windows, per-space redaction/DLP settings, grounded-only mode. `service_role`-write only.
- **`feature_states`** (config; RW6 — `tenant_id` + RLS + 4-state) and **`user_preferences`** (RW6) — C4 does not own these editors (W1/O3 manage `feature_states`; the user owns `user_preferences`), but C4 **reads** them for governance resolution (below) and validates writes through the policy backend.

### Reads (tenant-scoped SELECT under RLS, or `service_role` in the wrapper)
- **`roles` / `role_permissions` / `profile_roles`** (RW2) — capability checks (`governance.manage`, `doc.declassify`) and resolving the caller's role layer for feature precedence.
- **`spaces` / `space_members`** and **`documents.classification`** — classification/ACL enforcement (space membership + fixed 4-level).
- **`document_embeddings` / `message_citations`** (RW5) — grounded-only citation verification.
- **`settings` / `feature_states` / `user_preferences`** — 4-state governance resolution.
- **`inference_calls`** (single ledger, RW7) and **`messages`** (RW5) — signal + trace keys.
- **Structured datasets + column-sensitivity** tables (§3c; F1 §5 / C5) — the sensitive-structured-data guard reads column sensitivity + allowed-operation policy.

### Explicitly NOT used
- **No reversible redaction-mapping store in v1** (§2 W5). C4 emits one-way placeholders only. The `service_role`-only redaction-mapping table is a **post-v1** surface; C4 does not populate it in v1. (C5's ingestion path likewise stores placeholders only.)
- **Retired group-ACL** (`access_groups`/`group_levels`/`document_access`/`profile_groups`/`user_accessible_documents`) — classification enforcement uses **space membership + classification only** (§3, RW9).

---

## 4. Contracts

C4 is a Rust library. Its public surface is a set of traits + value types consumed by C1/D2/C5/X1, plus the JSON shapes those hosts expose to clients (governance settings RPC via C1's write path; trace/guard results embedded in the inference response for W2/W3).

### 4.1 Core Rust traits (crate `governance`)

```rust
/// The consumer-side wrapper entry point. C1/D2 hold one per process.
#[async_trait]
pub trait GovernancePipeline: Send + Sync {
    /// Pre-send: guard prompt + retrieved context + agent/tool messages before the engine call.
    /// Returns the transformed (redacted/masked) request, or a hard block.
    async fn guard_request(&self, ctx: &GovCtx, req: GuardInput) -> Result<Guarded<GuardInput>, GuardBlock>;

    /// Post-receive: guard a non-streamed model response before it reaches the user.
    async fn guard_response(&self, ctx: &GovCtx, resp: GuardInput) -> Result<Guarded<GuardInput>, GuardBlock>;

    /// Streaming: wrap an engine output stream with token-buffered windowed redaction (GH-6).
    fn guard_stream(&self, ctx: &GovCtx, stream: BoxStream<'_, EngineChunk>) -> BoxStream<'_, GuardedChunk>;

    /// Redact-at-rest (C5 ingestion) / tool egress (X1): scan + redact a text blob.
    async fn redact_text(&self, ctx: &GovCtx, kind: RedactKind, text: &str) -> RedactResult;
}

/// Detector plug-ins (vetted libraries; §2 W5). Never hand-rolled regex as the sole layer.
#[async_trait]
pub trait Detector: Send + Sync {
    fn name(&self) -> &'static str;                // "secret-scanner" | "pii-gliner" | ...
    async fn scan(&self, text: &str) -> Vec<Hit>;  // typed spans with confidence
}

pub struct GovCtx {
    pub tenant_id: Uuid,
    pub actor_id: Option<Uuid>,        // auth.uid() for user calls; None for system
    pub identity_kind: IdentityKind,   // person | service_account
    pub space_id: Option<Uuid>,
    pub role_ids: Vec<Uuid>,
    pub capabilities: CapabilitySet,   // resolved server-side (§ default: capabilities not in JWT)
    pub call_id: Uuid,                 // -> inference_calls / messages key
}

pub enum RedactKind { Ingestion, PromptEgress, ModelOutput, ToolInput, ToolOutput }

pub struct Hit { pub kind: EntityKind, pub start: usize, pub end: usize, pub confidence: f32, pub detector: &'static str }

pub enum EntityKind {                 // one-way placeholder taxonomy (v1)
    // secrets/credentials
    SecretAwsKey, SecretGcpKey, SecretAnthropicKey, SecretOpenaiKey, SecretGithubToken,
    SecretJwt, SecretPrivateKeyPem, SecretPassword, SecretHighEntropy,
    // PII
    PiiEmail, PiiPhone, PiiSsn, PiiCreditCard, PiiIban, PiiPerson, PiiAddress, PiiIpAddress, PiiDob,
}

pub struct RedactResult { pub text: String, pub hits: Vec<Hit>, pub redacted: bool }

pub struct Guarded<T> {
    pub value: T,                      // transformed payload
    pub result: GuardResult,           // what happened (for trace/signals/panels)
}

pub struct GuardResult {
    pub redacted_spans: Vec<Hit>,      // counts/types only surface to clients; offsets are internal
    pub classification_action: ClassAction,     // AllowedAll | MaskedContext { dropped_docs } | ...
    pub grounding: Option<GroundingResult>,      // when grounded-only applies
    pub injection: InjectionVerdict,             // Clean | Flagged { rule } | Blocked
    pub policy_hits: Vec<PolicyHit>,
    pub sensitive_data: Option<SensitiveDataAction>,
}

pub enum GuardBlock { Classification(String), Injection(String), GroundedOnly(String), Policy(String) }
```

**Placeholder format (v1, one-way, deterministic).** A hit is replaced by `⟦REDACTED:{TYPE}#{n}⟧` where `{TYPE}` is the `EntityKind` label and `{n}` is a per-call, per-distinct-value counter (so the *same* secret appearing twice in one request maps to the *same* placeholder within that request, preserving referential coherence for the model — **without** any persisted reversible mapping). Across calls there is **no** stable mapping (no reversible store, §2 W5).

### 4.2 Feature-governance resolution (4-state)

```rust
/// Precedence: workspace -> space -> role -> user (DECISIONS §4).
pub fn resolve_feature(ctx: &GovCtx, feature: &str) -> EffectiveFeature;

pub enum FeatureState { Locked, DefaultOn, DefaultOff, UserOverridable }
pub struct EffectiveFeature { pub enabled: bool, pub locked: bool, pub source: FeatureLayer }
pub enum FeatureLayer { Workspace, Space, Role, User }
```

Resolution algorithm: take the workspace default; if a more specific **space** policy exists it overrides (unless the workspace layer is `Locked`); a **role** policy narrows inside the space (never widens a `Locked`/`DefaultOff` that a higher layer locked); finally, if the resolved state is `UserOverridable`, apply the caller's `user_preferences` value. A `Locked` state at any layer freezes the value for all lower layers (`locked = true` in the result; W2 renders the toggle disabled).

### 4.3 "Why this model" trace

```rust
pub struct WhyThisModelTrace {
    pub call_id: Uuid,
    pub steps: Vec<TraceStep>,      // built from ChainEntry + Attempt + ExecutionTrace
    pub served: ServedModel,
    pub budget: BudgetDecision,     // reserved -> committed (from C3), or step-down / free-floor
    pub guards: Vec<GuardSummary>,  // redactions, classification, grounded-only, injection
}
pub struct TraceStep {
    pub position: u8,
    pub model: String,
    pub router: String,
    pub plane: Plane,               // local | cloud  — REQUIRES GH-1 (absent in v0.4.6 today)
    pub outcome: StepOutcome,       // served | fell_through(reason) | circuit_open | budget_stepdown
    pub latency_ms: u32,
}
```

### 4.4 JSON exposed via C1 (for W1/W2/W3)

- **Guard/trace on the inference response** — every `/v1/chat|generate|compare` response (C1) carries a `governance` block: `{ redactions: [{type, count}], classification: {...}, grounded: {cited: bool, score: f32}, injection: "clean|flagged|blocked", why_this_model: WhyThisModelTrace }`. Only **counts + types** of redactions are exposed — never offsets or the raw matched text.
- **Governance policy RPC (gateway-mediated write, §2 W1; capability `governance.manage`)** — a per-domain C1 endpoint, not a generic blob:
  - `POST /rpc/governance/set-masking-policy` — `{ scope: "workspace"|"space", space_id?, redaction: { enabled, detectors[], min_confidence }, pii_masking, retention_days }`
  - `POST /rpc/governance/set-classification-labels` — display-label relabels only (the 4-level set is fixed; rejecting any attempt to add/remove a level).
  - `POST /rpc/governance/set-grounded-only` — `{ scope, space_id?, mode: "off"|"annotate"|"block" }`
  - `POST /rpc/governance/set-feature` — `{ feature, scope, space_id?, role_id?, state: "locked"|"default-on"|"default-off"|"user-overridable" }` (the P6-live governance write endpoint)
  - `POST /rpc/documents/declassify` — capability `doc.declassify`; changes `documents.classification` for `{id}` (privileged, `service_role`-write); emits audit.
  All check the capability **server-side** and reject on absence (403 + audit).

### 4.5 Events emitted
- **Audit** → `audit_events` (O1), one row per policy/guard/redaction/config-change/access/export event.
- **Quality signal** → `quality_signals` (C6), keyed to `inference_calls`/`messages` — implicit/system signals from every guard application.

---

## 5. Security & RLS

C4 is a **security control**; its own posture is part of the build gate.

- **Authz via capabilities (server-side).** Capabilities are **resolved server-side** from `role_permissions` (they are **not** in the JWT — the JWT carries `tenant_id` + `role_ids` + a claims version). C4's policy-editor operations gate on the canonical capabilities **owned by F2**: `governance.manage` (edit masking/classification/retention/grounded-only/feature policy) and `doc.declassify` (lower a document's classification). Any policy write lacking the capability is rejected (403) and audited. RLS uses the `SECURITY DEFINER` capability-resolution helper (F2) for predicate checks.
- **Gateway-mediated writes (§2 W1).** All governance mutations flow through C1 domain RPC (§4.4); `audit_events`, `quality_signals`, `settings`, `feature_states`, and `documents.classification` are **`service_role`-write-only**. No direct PostgREST write path exists for them.
- **Tenant isolation.** Every C4 read/write is tenant-scoped via `GovCtx.tenant_id`; the wrapper never crosses tenants. Classification enforcement additionally scopes by `space_id` + membership. Cross-tenant context bleed is impossible because retrieval + citations are already tenant/space-scoped (C5) and C4 re-checks membership before including any retrieved chunk.
- **Secrets & redaction (the core of §2 W5).**
  - **Redact-before-egress is mandatory and fail-closed.** If a detector errors or times out on the **pre-send / tool-input / model-output / ingestion** path, C4 **blocks** (or drops the offending span) rather than letting unredacted text pass. Redaction failure is never fail-open.
  - **One-way placeholders only (v1).** No reversible mapping is persisted anywhere. Reversible un-redaction for authorized roles is explicitly **post-v1**.
  - **Detectors never log matched values.** Hit spans/values are held only in memory for the duration of the transform; audit/quality signals record **type + count + confidence**, never the raw secret/PII text. This is enforced by the `GuardResult` shape (offsets/values are not serialized to clients or the ledger).
  - **Vetted libraries, not hand-rolled regex** (§2 W5). See §7 for the detector stack; the secret ruleset is a published, versioned ruleset (gitleaks-class), not bespoke patterns.
- **Classification enforcement.** Non-members never receive `confidential`/`restricted` context; `restricted` is doc/space-owner only. C4 masks or drops such context **before** it reaches the prompt-assembly + model, and records a `MaskedContext` action.
- **Redaction runs on the local plane too.** The `governance` crate is compiled into **D2** (desktop local gateway), so redaction/DLP + classification apply to on-device inference exactly as centrally — sensitive data pinned to local execution (§3c) is still guarded, and nothing raw egresses even from the device.
- **Audit integrity.** C4-emitted `audit_events` bind `actor_id = auth.uid()` (or are `service_role`-only, gateway-emitted); the rows are append-only (no UPDATE/DELETE for `authenticated`).

---

## 6. Key flows

1. **Central non-streaming inference guard.** C1 receives an authorized `/v1/chat` request → builds `GovCtx` (tenant, actor, space, role_ids, resolved capabilities) → **`guard_request`**: (a) classification/ACL gate on retrieved context (drop/mask above clearance), (b) prompt-injection scan on prompt + retrieved/tool content, (c) **redaction** of prompt + context + agent messages (one-way placeholders), (d) sensitive-structured-data guard (§3c) → C3 reserve → engine `execute` → **`guard_response`**: (e) redact model output, (f) grounded-only check (verify citations), (g) assemble `WhyThisModelTrace` → C3 commit → persist `inference_calls` + `messages` → emit `audit_events` + `quality_signals` → return response with the `governance` block.
2. **Streaming inference guard (`execute_stream`, GH-6).** Same pre-send guard, then `guard_stream` wraps the engine SSE: maintain a **sliding buffer** of the last `W` characters (`W ≥` the longest detectable pattern, e.g. PEM blocks/JWTs) so a secret spanning chunk boundaries is caught; scan the buffered window each tick, **emit only the redaction-safe prefix**, hold back the tail; on stream end, run a final full-tail scan + flush. Grounding + trace are finalized on the terminal chunk. If a detector faults mid-stream, the stream is terminated fail-closed with a `GroundedOnly`/`Policy` block event.
3. **Ingestion redact-at-rest (C5 calls C4).** C5, during ingestion, calls `redact_text(ctx, Ingestion, markdown)` on the normalized markdown **before chunking/embedding**; C4 returns placeholder-substituted text + hits. The vector store/index only ever sees redacted text. Every redaction emits a quality/audit signal keyed to the document.
4. **MCP tool-egress redaction (X1 calls C4).** Before X1 sends tool **inputs** to an `http/sse/stdio` tool, it calls `redact_text(ctx, ToolInput, payload)`; before the tool **output** re-enters the model, it calls `redact_text(ctx, ToolOutput, payload)`. X1 owns allow-list + SSRF/sandbox; C4 owns the redaction. Each redaction is a signal.
5. **Classification / ACL enforcement.** For each retrieved chunk/citation, C4 checks the caller's space membership + the document's classification level against the fixed 4-level scheme; non-permitted chunks are dropped from context (and the answer cannot cite them). Result recorded as `ClassAction`.
6. **Sensitive-structured-data guard (§3c).** For a queryable dataset, C4 ensures the model receives **schema + non-sensitive metadata/aggregates only** (sensitive columns are F3-field-encrypted and never decrypted into the prompt); the model emits a computation plan (text-to-SQL/filter/formula); the app/gateway **executes it inside the trusted boundary** with aggregate-only / k-anonymity / min-group thresholds; the derived result passes a final `redact_text(ModelOutput,…)` check before reaching the model or user. Column sensitivity + allowed operations are space/admin policy; every compute is an audit + quality signal.
7. **Grounded-only enforcement.** When `grounded-only` policy resolves to `annotate` or `block` for the space: after generation C4 verifies the answer's claims are supported by cited retrieved context (citation coverage + grounding score). `annotate` → attach a low-grounding warning + score to the `governance` block; `block` → return `GuardBlock::GroundedOnly` instead of the ungrounded answer.
8. **Feature-governance resolution.** On any governed toggle (grounded-only, quality-judge, auto-tune-prompt, a specific retrieval mode, a tool), C4 runs `resolve_feature` with precedence **workspace → space → role → user**; a `Locked` layer freezes lower layers; `UserOverridable` applies `user_preferences` last. W2 renders locked toggles disabled.
9. **Policy edit (admin).** An admin/space-owner edits masking/classification-labels/retention/grounded-only/feature policy via the C1 governance RPC (§4.4); C1 checks `governance.manage` server-side, writes `settings`/`feature_states` as `service_role`, and C4 emits an `audit_events` config-change row. Classification **set** changes are rejected (relabel-display-only, §4).
10. **Audit + quality-signal emission.** Every guard application (redaction, classification action, injection flag, grounded-only outcome, sensitive-data compute, policy hit) produces one `audit_events` row (O1, immutable) **and** one `quality_signals` row (C6, keyed to `inference_calls`/`messages`) — types/counts/scores only, never raw matched text.

---

## 7. Gateway-crate dependencies

C4 consumes the `sensei-*` engine at **`v0.4.6`** strictly as a **consumer** — it wraps `execute`/`execute_stream` and reads the trace types; it does **not** patch the engine's request path.

- **Reads** `sensei-kernel` trace types — `ChainEntry`, `Attempt`, `ExecutionTrace`, `CircuitBreakerConfig` — to build the "why this model" trace.
- **Gateway-repo issues** (from [`../plans/gateway-issues.md`](../plans/gateway-issues.md); create → implement → close → lockstep tag bump, sequenced before the C4 phase):
  - **GH-1 — Per-step `plane` + execution-location on the trace** (*Blocking*). `ChainEntry`/`Attempt`/`ExecutionTrace` carry **no** `plane`/execution-location field in `v0.4.6`. The `WhyThisModelTrace.TraceStep.plane` (`local|cloud`) and O1's `execution_location` depend on it. Until it lands, C4 renders `plane = unknown` and the trace omits the split-plane badge. Sequenced before the C2/D3 phase, which C4's trace consumes.
  - **GH-6 — Streaming-safe governance/redaction hook** (*Investigate*). The engine exposes no in-request hook, so streamed output must be intercepted consumer-side. C4's **token-buffered sliding window** (flow 2) is the v1 approach and works without a crate change; the GH-6 investigation asks whether the crate can expose a **stream-transform / interception point** so redaction is cleaner (vs. buffering that risks defeating streaming). **Decision:** ship the consumer-side windowed transform for v1; file GH-6 to evaluate a first-class crate stream hook as an enhancement — do not block C4 on it.
  - **GH-7 — MCP / tool-calling support** (*Investigate, X1-owned*). C4 only redacts tool I/O; whether tool invocation is engine-exposed or built consumer-side is X1's question. Noted for coordination; not a C4 blocker.
- **No new gateway trait is required for C4 itself** — governance is deliberately consumer-side (§3). The detector libraries below are **Strategos-side dependencies**, not engine crates.

**Detector stack (Strategos-side, vetted — §2 W5):**
- **Secret scanner:** a published, versioned ruleset (gitleaks/detect-secrets-class signatures for AWS/GCP/Anthropic `sk-ant-`/OpenAI `sk-`/GitHub `ghp_`/PEM private keys/JWTs) **plus a Shannon-entropy** high-entropy-token detector. Delivered behind the `Detector` trait as `SecretScanner`.
- **PII classifier:** a **GLiNER-class NER** model served in-process via ONNX Runtime (reusing the `OrtAdapter` infra) as `PiiClassifier`, with an optional **Presidio** HTTP sidecar as a higher-recall fallback (behind the same trait, feature-flagged). These are the "vetted libraries" — the regex ruleset is a published set, not hand-rolled.

---

## 8. Decisions resolved

Applying the ratified architecture defaults + settling C4's residual questions:

1. **Governance is a consumer-side wrapper, not an in-engine hook.** *Rationale:* the `v0.4.6` engine has no in-request governance/stream hook (confirmed, GH-6); wrapping `execute`/`execute_stream` keeps governance in Strategos-owned code, testable independently of the crate, and reusable in both C1 (central) and D2 (local). Corrects the prior "inline guardrails" framing.
2. **Redaction = one-way placeholders in v1; no reversible mapping store.** *Rationale:* DECISIONS §2 W5 — reversible un-redaction for authorized roles is post-v1. C4 uses a per-call, per-distinct-value placeholder counter for referential coherence within a request, with **no** cross-call persistence.
3. **Detectors = vetted libraries, not hand-rolled regex.** *Rationale:* §2 W5. Secret scanning = published ruleset + entropy; PII = GLiNER-class ONNX NER in-process (+ optional Presidio sidecar). Behind a `Detector` trait so recall can be tuned per space via policy.
4. **Streaming redaction = token-buffered sliding window (consumer-side); GH-6 filed but non-blocking.** *Rationale:* preserves streaming UX while guaranteeing spans crossing chunk boundaries are caught; a first-class crate stream hook is a nice-to-have enhancement, not a v1 blocker.
5. **Redaction is fail-closed.** *Rationale:* a DLP control that fails open is worse than useless; detector faults/timeouts block or drop rather than leak.
6. **Classification = fixed 4-level; governance may relabel display names only.** *Rationale:* DECISIONS §4 — matches the DB CHECK constraints + classification RLS; the policy editor rejects set changes. ACL = space membership + classification only (group-ACL retired, §3/RW9).
7. **Feature governance = 4-state with precedence workspace → space → role → user.** *Rationale:* DECISIONS §4; `Locked` at any layer freezes lower layers; `user_preferences` supplies the user layer only where `UserOverridable`.
8. **Capabilities resolved server-side; C4 authz gates on `governance.manage` + `doc.declassify` (F2 owns the list).** *Rationale:* keeps the JWT bounded (carries `tenant_id` + `role_ids` + claims version); RLS uses the F2 `SECURITY DEFINER` helper. C4 references F2's canonical capability set rather than defining its own.
9. **C4 owns no new tables; it emits into `audit_events` (O1) + `quality_signals` (C6) and writes governance policy into `settings`/`feature_states` via C1's gateway-mediated path.** *Rationale:* DECISIONS §2 W1 (gateway-mediated writes) + §3b (C6 owns the signal store).
10. **Grounded-only is a per-space policy with `off | annotate | block` modes.** *Rationale:* different spaces tolerate different strictness; `block` is the safe default for high-classification spaces, `annotate` for exploratory ones.
11. **Redaction runs on the local plane (D2) as well as central (C1).** *Rationale:* §3c sensitive data pinned to on-device execution must still be guarded; the `governance` crate compiles into D2.
12. **Signals/audit record types/counts/scores only — never raw matched secret/PII text.** *Rationale:* a redaction control must not itself become the leak; enforced by the serialized shape.

---

## 9. Acceptance criteria (observable, testable)

1. **Redaction before egress (secrets).** Given a prompt containing an AWS key, an Anthropic `sk-ant-` key, a PEM private key, and a JWT, When it is sent through `/v1/chat`, Then the payload the engine/provider receives contains `⟦REDACTED:SECRET_*⟧` placeholders and **zero** raw secret characters; and the response `governance.redactions` lists the types + counts.
2. **Redaction before egress (PII).** Given retrieved context containing an email, phone, SSN, and person name, When assembled into the prompt, Then all are placeholder-substituted before egress; a fixture corpus achieves ≥ the configured recall threshold with no raw PII in the egressed payload.
3. **Redact-at-rest.** Given a document with an embedded secret ingested via C5, When embedding completes, Then the stored chunk text + any index entry contain only placeholders and **no** raw secret (assert against `document_embeddings`/artifact rows).
4. **Streaming redaction across chunk boundaries.** Given a streamed response where a secret is split across two SSE chunks, When streamed to the client, Then no chunk (nor the concatenation) contains the raw secret; the placeholder appears exactly once.
5. **Fail-closed.** Given a detector that errors/times out, When guarding a pre-send/tool/output/ingestion payload, Then the call is **blocked or the span dropped** — never passed through unredacted — and an audit row records the fault.
6. **Tool-egress redaction.** Given an MCP tool input/output containing a token, When X1 invokes the tool through C4, Then the token is redacted in both directions and a quality signal is emitted.
7. **Classification enforcement.** Given a `confidential` document and a non-member caller, When retrieval would include it, Then it is dropped from context, is not citable, and a `MaskedContext` action is recorded; a member of the space sees it.
8. **Grounded-only.** Given `grounded-only = block` for a space and a model answer with no supporting citation, When guarded, Then the ungrounded answer is replaced by a `GroundedOnly` block; under `annotate`, the answer returns with a low-grounding warning + score.
9. **Prompt-injection.** Given a known indirect-injection payload in retrieved context, When guarded, Then it is flagged/blocked per policy and audited.
10. **Sensitive-structured-data guard (§3c).** Given a dataset with a `salary` column marked sensitive, When a user asks for an aggregate, Then the model prompt contains schema + aggregates only (no raw salary rows), the app executes the plan in-boundary under the min-group threshold, and the result passes the output redaction check.
11. **"Why this model" trace.** Given a call that fell through one chain step to a fallback, When the response returns, Then `governance.why_this_model` shows the ordered steps, outcomes, served model, and budget decision; per-step `plane` is populated once GH-1 lands (else `unknown`).
12. **Feature governance precedence.** Given a feature `Locked = off` at the workspace layer and a user override attempting to enable it, When resolved, Then `enabled = false, locked = true, source = Workspace`; given `UserOverridable` with a user preference, Then the user value wins.
13. **Capability gating.** Given a caller without `governance.manage`, When they call `POST /rpc/governance/set-masking-policy`, Then 403 + an audit row; with the capability, the write succeeds and is audited.
14. **Declassify.** Given a caller without `doc.declassify`, When they call `POST /rpc/documents/declassify`, Then denied; with it, the classification lowers, is `service_role`-written, and is audited.
15. **No raw leak in signals/audit.** Given any redaction, When the `audit_events` / `quality_signals` rows are inspected, Then they contain type/count/confidence only and **no** raw matched text or span offsets.
16. **Signal + audit per guard.** Given any guarded call, When it completes, Then exactly one `quality_signals` row (keyed to the `inference_calls`/`messages` id) and the corresponding `audit_events` rows exist.
17. **Local-plane parity.** Given a request served entirely on the desktop local plane (D2), When it contains a secret/PII, Then redaction + classification apply identically to the central path.

---

## 10. Open questions

- **PII detector deployment (in-process ONNX vs. Presidio sidecar).** GLiNER-class ONNX in-process is the v1 default (no extra service, works on the local plane); a Presidio sidecar gives higher recall centrally but adds an ops surface and doesn't fit the desktop plane. Which ships as the default, and is the sidecar a central-only optional upgrade? (Trait abstracts both — decision is operational, not architectural.)
- **Grounding-score method + threshold.** How grounding is scored (citation-coverage vs. an NLI/entailment check vs. the LLM-as-judge from C6) and the numeric threshold for `annotate`/`block` — coordinate with C6 (the judge is itself a metered call).
- **Injection/jailbreak detector choice + tuning per space.** Which library/model, and whether sensitivity is a per-space policy knob (parallels redaction min-confidence).
- **GH-6 outcome.** Whether the crate gains a first-class stream-transform hook (cleaner than the windowed buffer) — affects only the streaming implementation, not the contract.
- **Redaction recall target per detector class** (shared with C5) — drives the min-confidence policy defaults and the acceptance-test fixture thresholds.
