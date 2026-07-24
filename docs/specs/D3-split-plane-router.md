# D3 · Split-plane router — Spec

**Module:** [D3](../modules/D3-split-plane-router.md) · **Plane:** Device (desktop, in-process) · **Status:** Planned
**Depends on:** [D1](../modules/D1-desktop-shell.md) (Tauri shell + IPC + local store), [D2](../modules/D2-local-gateway.md) (embedded engine adapters `ChatModel`/`EmbedModel` + model registry), [C1](C1-gateway-service.md) (cloud proxy target — `/v1/chat`·`/v1/embed` + device-status check), [C2](C2-routing-resilience.md) (resolved chain + per-step `plane`), [D4](../modules/D4-config-sync.md) (config snapshot, reachability, signed usage buffer), [F2](F2-identity-auth-rbac.md) (device token + Supabase JWT), [F3](F3-key-vault.md) (credential custody — central only, never on device), [C5](C5-rag-document-intelligence.md) (§3c sensitive-dataset compute on the local plane) · engine crates `sensei-*` @ `v0.4.6` (`sensei-gateway`, `sensei-kernel`, `sensei-local-*`)
**Enables:** W2 Ask/Activity execution-location badges + offline state, W3 Playground split-plane preview, O1 unified `execution_location` ledger, O2 plane-split savings analytics
**Date:** 2026-07-23 · **Language:** Rust (Tauri host) · **Reconciled to:** [`../DECISIONS.md`](../DECISIONS.md) · **Crate facts** verified against the C1/C2 specs + `v0.4.6` checkout

---

> **Reading order.** D3 is the **desktop brain**: it decides local-vs-cloud per request *and per fallback step*, executes a plane-spanning chain **as a single in-process `sensei-gateway` engine run**, and presents one unified result/trace. It sits **on top of** D2 (local adapters) and **in front of** C1 (the cloud plane), and consumes C2's resolved chain (with per-step `plane`) delivered through the D4 config snapshot. It owns **no schema** and holds **no provider credential** — those stay central (F3). Where this spec touches routing config it is authoritative for the *device-side walk*; the config itself is C2-owned and read-only on the device.

---

## 1. Purpose & scope

D3 turns a desktop inference request into an ordered walk across **two execution planes** — the embedded local engine (D2, in-process, `$0`, private) and the central gateway (C1, cloud BYOK) — and merges the attempts into **one unified `ExecutionTrace`** whose every step carries its `execution_location` (`local | cloud`). It is what makes "run private/offline on-device, burst to the cloud when needed, and never notice the seam" true for the Member Console.

The mechanism is deliberately **not** a bespoke chain-walker. D3 constructs the desktop's `sensei-gateway` engine with **one `AdapterRegistry` that contains both the D2 local adapters and a `RemoteGatewayAdapter`** (a capability-trait adapter — `ChatModel`/`EmbedModel` — that HTTP-proxies to C1). A resolved chain like `[opus(cloud) → sonnet(cloud) → gemma(local)]` is then walked by the engine's own selection + fallback machinery: `cloud` steps resolve to the remote adapter, `local` steps to the embedded adapter, and the single engine run emits one trace with per-step execution-location (needs **GH-1**).

**In scope**
- The **locality decision** per request/step: resolve C2's per-step `plane`, overlaid with on-device capability (D2), network reachability (D4), §3c sensitive-data pins, and privacy/feature governance.
- The **`RemoteGatewayAdapter`** — a `ChatModel`/`EmbedModel` implementation that proxies `cloud`-plane steps to C1 (`/v1/chat`, `/v1/chat/stream`, `/v1/embed`) with the device token + user JWT; provider credentials never touch the device.
- Registering both planes' adapters into the **same** `AdapterRegistry` and building the desktop `Gateway`.
- The **split-plane chain walk** producing **one unified `ExecutionTrace`** with per-step `execution_location`.
- **Offline behavior**: fail-with-local-fallback (engine fallback to a local step) for interactive inference; fail-fast with an actionable error when a cloud-only chain has no local step and the network is down.
- **Unified telemetry**: emit one call record per attempt (local `$0`, cloud priced) into the D4 signed+idempotent usage buffer → flushed to C1 → the single `inference_calls` ledger with `execution_location`.
- **§3c pin-sensitive-datasets-to-local**: force field-decrypt + compute onto the local plane (via C5's on-device `SecureExecutor`) even when the model/reasoning step is cloud; only schema + derived/aggregate results cross the local→cloud boundary, after W5 redaction.
- Tauri IPC surface consumed by the W2 Ask / Activity and W3 Playground frontends; per-step execution-location events that back the UI badges.

**Out of scope** (owned elsewhere)
- Local model execution, pull, registry, hardware detection → **D2** (D3 *consumes* its adapters + capability signals).
- Cloud inference, credential injection, budget reserve→commit, device-status verification, `inference_calls` persistence → **C1** (D3 *proxies to* it; C1 is the `service_role` writer).
- Chain CRUD, per-step `plane` authorship, chain binding, resilience policy → **C2** (D3 *reads* the resolved chain; never mutates).
- Config sync, Realtime subscription, reachability signal, the signed offline usage buffer + flush/reconciliation → **D4** (D3 *hands records to* the buffer).
- Retrieval/embedding pipeline + §3c `SecureExecutor`/dataset crypto → **C5** (D3 *orchestrates* which plane runs it).
- Provider-credential vault + DEK/KEK + OAuth refresh → **F3** (central; nothing on device).
- The budget cascade/hard-reserve math → **C3** (enforced centrally at C1; local `$0` steps consume no budget but are ledgered).

---

## 2. Responsibilities

1. **Decide locality** per request and per fallback step: take C2's per-step `plane` as the authoritative operator intent, then resolve the **actual executed plane** by overlaying on-device model availability + hardware capability (D2), network reachability (D4), §3c sensitive-data pins, and privacy/feature governance.
2. **Build the desktop engine**: register the D2 local adapters **and** the `RemoteGatewayAdapter` into a single `AdapterRegistry`; construct the in-process `sensei-gateway` `Gateway` with the D4-synced `GatewayConfig` (chains/models/routers + per-step `plane`); hot-reload it on config change (D4 `update_config`).
3. **Walk a plane-spanning chain** via the engine's own selection + fallback: `cloud` steps invoke the remote adapter (→ C1), `local` steps the embedded adapter (D2). No manual per-plane merge — the single run produces one trace.
4. **Proxy cloud steps** to C1 with the device session token + user JWT, stream results back, and map network/HTTP failures to engine `FallbackTrigger`s so the walk degrades to the next (local) step.
5. **Produce one unified `ExecutionTrace`** with per-step `execution_location` (GH-1) and surface per-step badges to the UI.
6. **Handle offline**: local fallback when the resolved chain has a local step; a clear, actionable offline error otherwise (never silently queue a user-awaited answer).
7. **Log every attempt** — local at `$0`, cloud priced — into the D4 signed+idempotent buffer so budgets stay unified and the device cannot forge/under-report; D4 flushes to C1, the sole ledger writer.
8. **Enforce the §3c local boundary**: run sensitive-dataset field-decrypt + compute on-device (C5), and let only schema + derived/aggregate results (post-W5-redaction) reach a cloud step.
9. **React to device revocation**: on a `403 device_revoked` from C1, stop cloud spending, surface a re-enroll prompt, and keep the local plane working.

---

## 3. Data model (F1 tables owned / used)

D3 is **schema-light** (like C2): it owns **no** table and, running on a device with **no `service_role`**, writes **nothing** to Postgres directly. All persistence flows through the D4 buffer → C1. It reads config from the D4 snapshot (RLS-scoped at sync time), never live PostgREST for privileged data.

### 3.1 Owned

None. (The only D3-authored artifacts are transient, in-memory: the assembled desktop `Gateway`, the per-request `ExecutionTrace`, and the buffered call records handed to D4.)

### 3.2 Used (read, via the D4 config snapshot — no secrets)

| Table / field | Use |
|---|---|
| `public.fallback_chains` + `public.fallback_chain_models.plane` (`local\|cloud`, C2/GH-1) | The resolved chain + per-step plane D3 walks. |
| `config.model_endpoints.local_capable` | Whether a model *can* run on the local plane at all (gates a `local` step's viability). |
| `config.models` / `config.model_capabilities` | Model↔capability (capability is a **model** attribute, DECISIONS §3) — pick the embedding/chat model for the plane. |
| `public.datasets.plane_pin` (`auto\|local`) + `public.dataset_columns.sensitivity`/`encrypted` (C5, §3c) | Force local-plane compute for sensitive datasets. |
| `config.feature_states` / `public.user_preferences` (4-state governance, via D4) | Privacy mode / "local-only" governance that can force a plane. |
| `public.devices.status` | Local mirror of enrollment state; the authoritative check is C1 on the hot path. |

### 3.3 Written — indirectly, via D4 → C1 (`service_role`)

| Table | Shape D3 contributes | Path |
|---|---|---|
| `public.inference_calls` | One record per attempt: `execution_location` (`local\|cloud`), `cost_usd` (`0` for local), tokens, model/adapter, tenant + subject-node attribution, idempotency key. | D3 → D4 signed buffer → C1 `PgGatewayStore` (`service_role`). |
| `public.execution_traces` | The unified `ExecutionTrace` JSON (attempts, fallbacks, per-step `execution_location`, GH-1). | Same path; FK `(tenant_id, inference_call_id)`. |

> **Anti-forgery.** Local `$0` rows and traces are queued into the D4 buffer that is **signed + idempotent** (anti-replay / anti-under-report, DECISIONS §2). A device cannot fabricate cost, drop spend, or replay a committed call; C1 reconciles on flush.

---

## 4. Contracts

### 4.1 Rust — the split-plane engine assembly (in-process, `src-tauri`)

```rust
/// Cloud plane as a capability-trait adapter, registered into the SAME AdapterRegistry
/// as D2's local adapters. It holds NO provider credential — it authenticates to C1
/// with the device session token + the user's Supabase JWT and proxies the call.
pub struct RemoteGatewayAdapter {
    c1_base: Url,                     // e.g. https://api.… (127.0.0.1:8787 in dev)
    device_token: DeviceToken,        // OS keychain (D1); NOT a provider credential
    jwt_provider: Arc<dyn JwtProvider>, // current user Supabase JWT (F2)
    http: reqwest::Client,
}

#[async_trait]
impl ChatModel for RemoteGatewayAdapter {
    async fn chat(&self, req: &ChatRequest) -> Result<ChatResponse, GatewayError>;
    async fn chat_stream(&self, req: &ChatRequest)
        -> Result<BoxStream<'_, Result<StreamChunk, GatewayError>>, GatewayError>;
}
#[async_trait]
impl EmbedModel for RemoteGatewayAdapter {
    async fn embed(&self, req: &EmbedRequest) -> Result<EmbedResponse, GatewayError>; // 1024-dim
}
// Network unreachable / 5xx / timeout  → GatewayError mapped to FallbackTrigger
//   (Timeout | ProviderError | RateLimit) so the engine advances to the next step.
// 403 device_revoked / 401             → non-fallback terminal error (stop cloud spend).

/// D3 builds the desktop engine ONCE (rebuilt on D4 config change).
pub struct SplitPlaneRouter { gateway: Gateway /* sensei-gateway */, /* … */ }

impl SplitPlaneRouter {
    /// Register D2 local adapters + RemoteGatewayAdapter into one AdapterRegistry,
    /// then Gateway::new(config, registry, breaker). Cloud routers bind to the remote
    /// adapter; local routers bind to the embedded adapter (D2).
    pub fn build(cfg: GatewayConfig, local: LocalAdapters, remote: RemoteGatewayAdapter) -> Self;

    /// Resolve the ACTUAL executed plane per step before/while walking (§4.4).
    fn resolve_locality(&self, planned: &ResolvedChain, ctx: &DeviceCtx) -> PlannedWalk;

    /// Run the chain as a single engine execution → one unified trace.
    pub async fn execute(&self, req: InferenceRequest, ctx: DeviceCtx)
        -> Result<InferenceResponse /* + ExecutionTrace */, RouterError>;
    pub async fn execute_stream(&self, req: InferenceRequest, ctx: DeviceCtx)
        -> Result<BoxStream<'_, StreamChunk>, RouterError>;

    /// Hot-reload the engine config from the D4 snapshot (Gateway::update_config).
    pub fn reload(&self, cfg: GatewayConfig) -> Result<(), RouterError>;
}
```

### 4.2 Locality decision — inputs & precedence

```rust
struct DeviceCtx {
    online: bool,                       // D4 reachability
    local_models: HashSet<ModelId>,     // downloaded + ready (D2 registry)
    hw: HardwareCaps,                    // RAM/VRAM/accel (D2 detection)
    privacy_local_only: bool,           // feature-governed / user pref (D4)
    dataset_pin: Option<PlanePin>,       // §3c: Some(Local) forces local compute
}
```
For each chain step, the **planned plane** = C2's `fallback_chain_models.plane`. The **executed plane** is derived:
1. **§3c pin** (`dataset_pin == Local`) → the *sensitive compute* is forced `local` regardless of the model step's plane (§6.7).
2. **Privacy/feature governance** (`privacy_local_only`) → cloud steps are skipped; only `local` steps are viable (a cloud-only chain then errors, §6.5).
3. **Capability viability** — a `local` step is viable only if its model is `local_capable` **and** downloaded/ready **and** the hardware supports it (D2); otherwise the step is skipped (fallback advances) or pulled-then-run per policy (open Q4).
4. **Reachability** — a `cloud` step is viable only if `online`; offline → the remote adapter fails fast → engine fallback (§6.4).
5. Otherwise the executed plane = the planned plane.

D3 records **both** the planned plane and the actual `execution_location` on each `Attempt`; the actual drives the UI badge and the ledger.

### 4.3 Tauri IPC — surface consumed by W2/W3 frontends

D3 backs the Ask/Playground inference commands (the frontend does not talk to C1 directly for chat/embed on desktop — it goes through D3 so the local plane and unified trace apply):

```jsonc
// invoke("d3_infer", { messages, system?, chain?, model?, space_id?, conversation_id?, max_tokens? })
//   -> { content, model, adapter, usage, cost_usd, execution_location, trace_id,
//        steps: [ { model, plane_planned, execution_location, status, cost_usd } ] }
// invoke("d3_infer_stream", { … })  // Tauri channel: chunk events + a final `done` (usage/cost/trace)
// invoke("d3_embed", { input, space_id? })         -> { embedding: number[1024], execution_location }
// invoke("d3_preview_plane", { capability, space_id }) // no execution — for the Playground preview
//   -> { chain_id, steps: [ { model, router, plane_planned, plane_predicted, reason } ] }
```
The resolved chain + per-step planes come from C2's IPC (`invoke("routing_resolved_chain", { capability, space_id })`, C2 §4.3); D3 overlays `DeviceCtx` to produce `plane_predicted`.

### 4.4 HTTP — cloud plane (what `RemoteGatewayAdapter` calls on C1)

| C1 endpoint | When | Auth |
|---|---|---|
| `POST /v1/chat`, `POST /v1/chat/stream` | a `cloud` chat/reasoning step | `Authorization: Bearer <user JWT>` + device token header |
| `POST /v1/embed` | a `cloud` embedding step | same |
| `GET /v1/whoami` | device-status / capability sanity (debug) | same |

C1 owns credential injection, the **device-status check on the hot path**, the budget reserve→commit, the C4 redaction wrapper, and ledger persistence for the cloud attempt. D3 supplies only the request + identity; it receives the priced result and folds it into the unified trace.

### 4.5 Events

- **Per-step execution-location** → emitted to the UI (Tauri event) as each attempt resolves, backing the W2/W3 badges ("ran on your device" vs "via gateway"); the final unified trace carries the full per-step list.
- **Offline / degraded** → D3 reflects D4's reachability into the request outcome (offline banner, "served locally" note, or the fail-fast error).
- **`device_revoked`** → on a C1 `403 device_revoked`, emit a re-enroll event; cloud steps are disabled until re-enrolled (local keeps working).
- **Call records** → each completed attempt is pushed to the D4 usage buffer (not a UI event) for flush → `inference_calls`.

---

## 5. Security & RLS

- **No provider credentials on the device (DECISIONS §2 W4).** The `RemoteGatewayAdapter` holds **only** the device session token (OS keychain, D1) + the user's Supabase JWT. Provider BYOK keys / OAuth tokens live solely in the central F3 vault and are injected by C1 at call time — they never sync, never reach D2/D3, never appear in a device log or trace.
- **Cloud spend is gated by C1's device-status check (DECISIONS §2 apply-without-asking).** Every `cloud` step hits C1, which verifies `devices.status` on the hot path; a revoked device with a live JWT gets `403 device_revoked` and **cannot keep spending**. D3 treats that as terminal (no fallback-to-cloud retry), stops cloud attempts, and keeps the local plane available.
- **Unified, un-forgeable metering.** Local `$0` attempts and cloud attempts are recorded through the D4 **signed + idempotent** buffer; the device cannot forge cost, under-report, or replay. C1 (`service_role`) is the only ledger writer; D3 never writes Postgres.
- **Tenant isolation.** Every cloud call carries the user JWT (tenant claim); C1 scopes by the verified claim, never by a device-supplied tenant. The device config snapshot is RLS-scoped at sync time (D4) — a device only ever holds its own tenant's chains/models.
- **§3c local boundary (DECISIONS §3c).** For a sensitive dataset (`plane_pin='local'` or sensitive/restricted columns), D3 forces field-decrypt + compute onto the local plane (C5 `SecureExecutor`). Only the **schema + non-sensitive metadata/aggregates + the derived, policy-gated result** may cross to a `cloud` model step, and only after the **W5 redaction check** (C4 on-device wrapper). Raw sensitive values never leave the machine. If a step would send a raw sensitive value to cloud, D3 blocks it (fails the request) rather than leak.
- **Redaction in-flight for local→cloud egress (DECISIONS §2 W5).** When a `local` step's output feeds a `cloud` step (or the user's prompt + local context egress to cloud), the payload passes the C4 on-device redaction (one-way placeholders, v1) before it hits the `RemoteGatewayAdapter`. Cloud-side redaction is additionally applied centrally by C1/C4.
- **No secret leakage in traces/logs.** The unified `ExecutionTrace` and any log line carry model/adapter/plane/cost — never a credential, never a raw sensitive value. The `RemoteGatewayAdapter`'s request builder relies on the crate's redacting `Debug`; D3 must never `{:#?}` a config or request that could contain a token.
- **Negative-test gate.** Prove: a revoked device cannot complete a cloud step (403) but *can* still run a local step; a raw `sensitive`-column value is never present in any payload sent to the `RemoteGatewayAdapter`; a local `$0` row cannot be replayed or edited to alter cost after buffering; a device only ever sees its own tenant's config.

---

## 6. Key flows

**6.1 — Locality resolution (per request).**
1. Frontend calls `d3_infer` with `{ chain|model, space_id, … }`.
2. D3 gets the resolved chain + per-step planned planes from C2 (`routing_resolved_chain`, served from the D4 snapshot).
3. D3 assembles `DeviceCtx` (reachability from D4; local model readiness + hardware from D2; privacy governance; §3c dataset pin).
4. Per §4.2, D3 computes the executed plane for each step (recording planned + predicted). The result is a `PlannedWalk` handed to the engine.

**6.2 — Split-plane chain walk (single engine run).**
1. D3 executes the chain on the desktop `Gateway` (one `AdapterRegistry` holding D2 local adapters + `RemoteGatewayAdapter`).
2. The engine walks steps in `priority` order: a `local` step invokes the embedded adapter (D2, `$0`); a `cloud` step invokes the `RemoteGatewayAdapter` → C1.
3. Each attempt appends to **one** `ExecutionTrace` with its `execution_location` (GH-1). The engine's fallback triggers advance on failure (§6.4).
4. On success, D3 returns `{ content, usage, cost_usd, execution_location, steps[] }` and pushes the attempt record(s) to D4 (§6.6).

**6.3 — Cloud step proxy (`RemoteGatewayAdapter` → C1).**
1. Build the C1 request from the engine's `ChatRequest`/`EmbedRequest`; attach the user JWT + device token.
2. `POST /v1/chat` (or stream/embed). C1 does device check → budget reserve → C4 pre-redaction → `Gateway::execute` → C4 post → commit → persists its own cloud ledger row and returns the priced result.
3. D3 folds C1's returned usage/cost/model into the unified trace as a `cloud` attempt. (The cloud row is persisted centrally by C1; D3 does **not** double-log it — it logs only the *local* attempts, plus the trace envelope; see §6.6.)

**6.4 — Offline → local fallback (interactive).**
1. Network is down (D4). A `cloud` step's `RemoteGatewayAdapter` call fails fast → `GatewayError` mapped to `Timeout`/`ProviderError`.
2. The engine's fallback trigger advances to the next step. If a later step is `local` and viable, it serves the answer on-device (`$0`).
3. The unified trace shows the cloud attempt(s) `skipped`/`failed` and the local attempt `served`; the UI shows "cloud unreachable — served locally".

**6.5 — Offline, cloud-only chain → fail-fast (no silent queue).**
1. The resolved chain has **no** viable local step (all `cloud`, or privacy-local-only with a cloud-only chain) and the network is down.
2. D3 returns an **actionable error** immediately (`offline_no_local_fallback`) — it does **not** queue a user-awaited inference (a stale answer is useless). The UI offers "retry when online" / "pick a local-capable chain".
3. (Queue-and-retry via D4 applies only to the **usage/audit telemetry buffer** — never to a pending inference result.)

**6.6 — Unified trace + `$0` local logging → D4 → C1 ledger.**
1. For each **local** attempt, D3 builds an `inference_calls` record (`execution_location='local'`, `cost_usd=0`, tokens, model, subject-node attribution, idempotency key) + its slice of the trace.
2. Records are pushed to the D4 signed+idempotent buffer; D4 flushes to C1 which writes them as `service_role` into the single `inference_calls` ledger + `execution_traces`.
3. Cloud attempts are ledgered by C1 at call time; D3 stitches the returned `inference_call_id`/`trace_id` into the unified trace so O1/O2 see one coherent split-plane trace.

**6.7 — §3c sensitive-dataset pin-to-local.**
1. An Ask/compute targets a dataset with `plane_pin='local'` or sensitive/restricted columns.
2. D3 forces the **compute** step local: it invokes C5's on-device `c5_dataset_compute` (field-decrypt inside the trusted local boundary via the tenant DEK, then execute-in-app — DuckDB SELECT/aggregate, k-anon/threshold gated).
3. Only the **schema + non-sensitive aggregates + the derived result** (post-W5 redaction) are passed to the model/reasoning step — which **may be `cloud`**. Raw sensitive values never leave the device.
4. The trace records the compute step as `local` (sensitive) and the reasoning step at its actual plane; every compute emits an audit + quality signal (C5/C6).

**6.8 — Device revocation mid-session.**
1. Admin revokes the device (O3). C1's next hot-path check returns `403 device_revoked` for a `cloud` step.
2. D3 stops cloud attempts (terminal, no retry), emits a re-enroll event, and — if the chain has a local step — continues to serve locally; otherwise it surfaces the offline/blocked state.

**6.9 — Streaming chat across planes.**
1. `d3_infer_stream` runs the walk; a `cloud` step streams via `RemoteGatewayAdapter::chat_stream` (SSE from C1, redaction applied centrally); a `local` step streams from D2.
2. D3 forwards chunks over the Tauri channel and, on stream end, emits `done` with usage/cost + `trace_id`, then buffers the local-attempt record. A mid-stream cloud disconnect either falls back to a local step (if the stream had not committed output) or surfaces a partial + retry (open Q3).

---

## 7. Gateway-crate dependencies

Consumes `sensei-gateway` + `sensei-kernel` + `sensei-local-*` @ pinned **`v0.4.6`** (dev-in-place via `[patch]`; see [[project-gateway-crate]], [[feedback_gateway_release_flow]]). Reused: the `Gateway` engine + selection/fallback/circuit-breaker (walks the plane-spanning chain), the `AdapterRegistry` + `RegisterInto`/capability-trait model (registers local **and** remote adapters), `ChatModel`/`EmbedModel` (implemented by both D2 adapters and `RemoteGatewayAdapter`), `ExecutionTrace`/`Attempt` (unified trace).

| Issue | What D3 needs | Blocking? |
|---|---|---|
| **GH-1** | Per-step `plane` on `ChainEntry` + an **`execution_location` field on `Attempt`/`ExecutionTrace`** ([`../plans/gateway-issues.md`](../plans/gateway-issues.md)). Confirmed absent in `v0.4.6`. Without it D3 cannot (a) let the engine route a step to the local-vs-remote adapter by plane, nor (b) record per-step execution-location in the one unified trace. | **Yes — sequenced before the C2/D3 phase.** |
| (GH-6) | Streaming-safe redaction hook — informs whether a `local`-step stream that egresses to cloud, or a cloud stream needing on-device redaction, buffers or uses a crate transform point. | Investigate with C4 streaming. |

D3 files **no new** gateway issue; it depends on **GH-1** (owned by the C2/D3 phase) and references GH-6. The `RemoteGatewayAdapter` is **Strategos-side code**, not a crate change — it implements the public `ChatModel`/`EmbedModel` traits and registers via the existing `AdapterRegistry`/`RegisterInto` surface (same mechanism C1 uses for cloud adapters, MIG-2). No provider-credential/OAuth crate work (GH-2) touches the device — cloud custody is central.

---

## 8. Decisions resolved

Settling D3's residuals per the RESOLVED ARCHITECTURE DEFAULTS + the module seed's open questions:

1. **Cloud steps proxy through a `RemoteGatewayAdapter` registered into the *same* `AdapterRegistry` as the local adapters — not a bespoke chain-walker.** The desktop runs **one** `sensei-gateway` engine; the chain's per-step `plane` selects the local-vs-remote adapter; the single run yields **one** unified `ExecutionTrace`. *Rationale: the brief's ratified mechanism — it gets the unified trace and cloud→local fallback "for free" from the engine's own machinery, and keeps D3 thin. Manual merging would duplicate selection/fallback logic and risk trace divergence.*
2. **Offline behavior = fail-with-local-fallback for interactive inference; fail-fast (no queue) when a cloud-only chain has no local step.** A `cloud` step failing offline maps to a `FallbackTrigger` so the engine advances to a viable `local` step; if none exists, D3 returns an actionable `offline_no_local_fallback` error. *Rationale: resolves the seed's "queue-and-retry vs local fallback" question — a queued, stale answer to a waiting user is useless; local fallback is the desktop superpower. Queue-and-retry (D4) is reserved for the telemetry/usage buffer, never for a pending answer.*
3. **The executed `execution_location` may differ from the planned `plane`; D3 records both.** Capability detection, reachability, privacy governance, or a §3c pin can force a plane change; the **actual** location drives the badge and the ledger, the planned plane is kept for the "why this step" trace. *Rationale: badges + analytics must reflect where the work actually ran, not the operator's intent.*
4. **Local calls are logged at `$0` through the D4 signed+idempotent buffer → C1 (`service_role`); D3 never writes Postgres.** *Rationale: the device has no `service_role`; DECISIONS §2 requires signed, anti-replay, anti-under-report buffering so budgets stay unified and un-forgeable.*
5. **§3c sensitive compute pins to the local plane; only schema + derived/aggregate results (post-W5-redaction) cross to a cloud step.** D3 blocks any payload carrying a raw sensitive value from egressing to the `RemoteGatewayAdapter`. *Rationale: DECISIONS §3c — the model sees structure, not values; the app does the math on-device.*
6. **Locality decision inputs (resolving the seed q)** = C2's per-step `plane` (authoritative operator config) overlaid with on-device model availability + hardware (D2), network reachability (D4), §3c dataset pin, and privacy/feature governance (D4). *Rationale: the plane is operator-managed config, not a device guess (no-hardcoded-ops); the device only *degrades* within that intent.*
7. **The `RemoteGatewayAdapter` carries no provider credential** — it authenticates to C1 with the device token + user JWT only; C1 does the device-status check, credential injection, budget, and redaction. *Rationale: DECISIONS §2 W4 — credential custody is central; a device compromise must not expose provider keys or bypass spend controls.*
8. **D3 is sequenced after GH-1.** Per-step `plane` on `ChainEntry` + `execution_location` on `Attempt`/`ExecutionTrace` are the real blocking gap. *Rationale: C2 §7 + gateway-issues confirm GH-1 absent in `v0.4.6`; the unified split-plane trace cannot exist without it.*

---

## 9. Acceptance criteria (observable, testable)

1. **Split-plane walk, single trace.** A chain `[opus(cloud) → sonnet(cloud) → gemma(local)]` executed via `d3_infer` returns **one** `ExecutionTrace` whose attempts carry per-step `execution_location` matching each step's resolved plane; the cloud attempts show a real C1-served answer and the local attempt (when reached) shows `$0`.
2. **Same-registry adapter routing.** The desktop `Gateway` is built from one `AdapterRegistry` containing D2 local adapters **and** the `RemoteGatewayAdapter`; a `cloud` step invokes the remote adapter (HTTP to C1) and a `local` step the embedded adapter — asserted by trace `adapter` + `execution_location`.
3. **Offline → local fallback.** With the network down and a chain that has a viable local step, `d3_infer` returns a **locally-served** answer; the trace shows the cloud step(s) failed/skipped and the local step served; the UI receives "served locally".
4. **Offline, cloud-only → fail-fast.** With the network down and a cloud-only (or privacy-local-only + cloud-only) chain, `d3_infer` returns `offline_no_local_fallback` **immediately** and **queues no inference**; no partial answer is fabricated.
5. **Unified `$0` ledger.** A local attempt produces exactly one `inference_calls` row (via D4 flush → C1) with `execution_location='local'`, `cost_usd=0`, correct tenant + subject-node attribution, and a stable idempotency key (re-flush does not duplicate it).
6. **No provider credential on device.** No provider key/OAuth token is present in the device process, any device log, the config snapshot, or the `RemoteGatewayAdapter` request/trace (asserted by a log/heap-scan test); cloud steps still succeed (credential injected centrally by C1).
7. **Device revocation.** After the device is revoked, a `cloud` step returns `403 device_revoked` and D3 stops cloud attempts (no retry) while a `local` step still serves; a re-enroll prompt is emitted.
8. **§3c pin.** An Ask over a dataset with a `sensitive` column runs the compute on-device (`c5_dataset_compute`), sends **only** schema + aggregates + derived result to a `cloud` reasoning step, and **no raw sensitive value** appears in any payload to the `RemoteGatewayAdapter`; the trace marks the compute step `local`.
9. **Executed-vs-planned plane.** When a step planned `local` is not viable (model not downloaded / hardware insufficient), D3 records the planned plane but the actual `execution_location` reflects the step that served (skip-to-next or pulled), and the badge shows the actual location.
10. **Config hot-reload.** After D4 pushes a chain/plane change, a subsequent `d3_infer` walks the new planes without an app restart (`Gateway::update_config`).
11. **Streaming.** `d3_infer_stream` streams chunks from a `local` or `cloud` step and ends with a `done` event carrying usage/cost + `trace_id`; a completed stream buffers exactly one local ledger row (for a local step) or stitches C1's `inference_call_id` (for a cloud step).
12. **Preview = no execution.** `d3_preview_plane` returns per-step planned + predicted planes and records **no** `inference_calls` row and makes **no** cloud call.

---

## 10. Open questions (genuine)

1. **Adapter selection keying by plane.** How the engine routes a step to the *local* adapter vs the `RemoteGatewayAdapter` when the same catalog `model` id can exist on both planes — does GH-1's `plane` on `ChainEntry` drive adapter selection directly, or must D3 model the two planes as **distinct router ids** (a `-local` router bound to the embedded adapter, a `-cloud` router bound to the remote adapter) so the existing router→adapter map suffices? Confirm the exact keying with GH-1 during the C2/D3 phase.
2. **On-device DEK custody for §3c field decryption.** F3/C5 say sensitive columns are decryptable "on the on-device plane," but the mechanism that delivers a per-tenant DEK to the device (and how it is custodied — OS keychain, session-scoped, never persisted) is unspecified. Needs an F3 decision before §3c local compute ships; until then §3c may be central-only on desktop.
3. **Mid-stream cloud disconnect.** When a `cloud` stream drops after partial output, the recovery policy — restart on a local step (discarding partial), resume from C1, or surface partial + retry — is undecided; interacts with GH-6 streaming redaction.
4. **Local-step viability thresholds + not-viable policy.** The concrete hardware signal (RAM/VRAM/model size) that marks a `local` step viable, and the behavior when a planned-`local` step is not viable — **pull-and-wait** (block on D2 download) vs **skip-to-next** (fallback) — needs a policy (likely feature-governed, per D2 capability detection).
