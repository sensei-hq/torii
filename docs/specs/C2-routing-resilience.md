# C2 · Routing, chains & resilience — Spec

**Module:** [C2](../modules/C2-routing-resilience.md) · **Plane:** Central · **Status:** Planned
**Depends on:** F1 (schema), F2 (capabilities/JWT), C1 (gateway service + gateway-mediated writes), C3 (budget headroom), engine crates `sensei-*` @ `v0.4.6` (`sensei-gateway`, `sensei-kernel`) · **Enables:** C1 request execution, C3 (budget-filtered selection feeds reserve), C4 ("why this model" trace), D3 (split-plane chain walk), O1/O2 (execution-location ledger + plane-split analytics), W1 (chain editor / simulator)
**Date:** 2026-07-23 · **Reconciled to:** [`../DECISIONS.md`](../DECISIONS.md) · **Crate facts verified against** `v0.4.6` checkout (`crates/kernel/src/types/{config,trace,capability}.rs`, `crates/gateway/src/{selection,budget,circuit_breaker}.rs`)

---

> **Reading order.** This spec is authoritative for how a Torii request resolves to a model and degrades gracefully. It sits **on top of** the `sensei-gateway` engine (which owns model selection, fallback execution, and the circuit breaker) and **behind** C1 (the only writer for privileged chain config, per DECISIONS §2 W1). It does **not** own budget accounting (C3), credential decryption (C1/F3), governance/redaction (C4), or the local execution plane (D2/D3) — it composes with them.

---

## 1. Purpose & scope

Define how Torii turns an inference request for a **capability** (chat/reasoning, embedding, later rerank) into an ordered set of model attempts, degrades gracefully when a provider fails or budget runs low, and exposes all of it as **editable, per-space/role config** with a **read-only simulator** that becomes an editable chain editor (W1).

The engine (`sensei-gateway`) already implements the mechanics — 3-tier model selection, fallback execution, a per-endpoint circuit breaker, and a soft budget-affordability filter. C2 is the **Torii-side skin** over those mechanics: it maps F1 DB config → the engine's `GatewayConfig`, adds Torii concepts the engine lacks (**per-step plane**, **per-space/role chain binding**, **feature-governed chain selection**, **provider health surface**), and enforces that all chain mutations go through C1's capability-checked domain RPC.

**In scope**
- Capability-managed **fallback chains** — chat/reasoning and embedding are each a chain; rerank is a chain shape reserved for the C5 rerank service (§8).
- **Chain CRUD** over `fallback_chains`/`fallback_chain_models`, gateway-mediated (`service_role`-write via C1).
- **Per-step plane** (`local | cloud`) on each chain step (requires **GH-1** crate trace enhancement).
- **Chain binding** — which chain a given (capability × space × role) resolves to.
- **Circuit breaker** configuration + health surface (wraps the crate's `CircuitBreakerManager`).
- **FallbackTrigger** policy — which of the 5 engine triggers a chain honors; the editor exposes exactly what the crate supports.
- **Routing policy** — retry budget, hard timeout, region pin, health-check interval, breaker thresholds.
- **Budget-filtered selection** — feeding the remaining-headroom signal into the engine's affordability filter and step-down; the authoritative reserve→commit is C3 (§8).
- The **simulator/dry-run** contract (resolve a chain without executing) that backs the W1 editor and the D3 split-plane preview.

**Out of scope** (owned elsewhere)
- Budget accounting, reserve→commit, cascade/rollup, hard-cap enforcement → **C3** (C2 only *consumes* headroom and *reports* which step was chosen).
- Credential decryption, JWT verify, HTTP termination, `GatewayStore` persistence → **C1**.
- Governance/redaction wrapper around `execute`/`execute_stream` → **C4**.
- Local in-process inference + the device-side locality decision → **D2/D3** (C2 only *labels* steps with a plane; D3 *acts* on it).
- Panels / consensus workflows (`PanelConfig`/`ConsensusConfig`) → **W3 Compare** consumes them; C2 only owns the chains those slots reference.
- The chain **editor UI** and simulator rendering → **W1** (C2 provides the data + dry-run endpoint).

---

## 2. Responsibilities

1. **Assemble engine config from the DB.** Build `GatewayConfig.chains` (a `HashMap<String, FallbackChainConfig>`), `models`, and `routers` for a tenant from F1 catalog + routing tables, resolving per-tenant catalog overrides.
2. **Resolve the chain for a request.** Given `(tenant, capability, space, role)` (+ optional explicit chain override), pick the bound chain by the precedence ladder (§6 flow 1), honoring feature governance.
3. **Own chain CRUD + binding**, exposed only through C1's capability-checked domain RPC (`chain.write`) — never direct PostgREST.
4. **Label each step with a plane** (`local|cloud`) and propagate it into the engine config + trace (via GH-1) so D3 can walk a plane-spanning chain and O1 can record `execution_location`.
5. **Configure & surface resilience** — circuit-breaker thresholds, retry/timeout/region-pin routing policy, and a `provider_health` view that reflects live breaker state + probe results.
6. **Feed budget-aware selection** — pass the caller's remaining budget headroom (from C3) as `SelectionCriteria.budget` so the engine's affordability filter steps down; expose which step served (primary / stepped-down / free-floor / resilience-fallback).
7. **Provide a dry-run simulator** — resolve + rank candidates and report skips/plane/est-cost **without executing**, for the W1 editor and D3 preview.

---

## 3. Data model (F1 tables owned & used)

C2 is a schema-light module: the engine holds the runtime state (circuit breaker is **in-memory/ephemeral**, §5) and F1 holds the config. References the F1 rework ([`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md), RW1 authz + RW10 catalog).

### 3.1 Owned (routing config)

| Table | Purpose | Notes / rework linkage |
|---|---|---|
| `fallback_chains` | One row per named chain: `id`, `tenant_id`, `capability` (engine `Capability`, §3.3), `name`, `purpose_label` (e.g. "chat", "reasoning", "embedding", "cheap", "local", "demo"), `fallback_triggers text[]` (subset of the 5 engine triggers, §4.4), `enabled`, `is_default` (per-capability tenant default), audit cols. | Exists in built schema; **`service_role`-write-only** (RW1). Add `fallback_triggers`, `purpose_label`, `is_default` if absent. |
| `fallback_chain_models` | One row per **step**: `chain_id`, `model_id`, `router_id`, `priority smallint` (maps to `ChainEntry.priority: u8`), **`plane text` CHECK (`local`\|`cloud`)** (C2, GH-1), `api_model_id` override (nullable). | `plane` column is the C2 addition (F1 §8 migration step 4). Composite FK `(tenant_id, chain_id)`. |
| `chain_bindings` **(new — C2 proposes; not in built F1)** | Resolves `(capability, space_id?, role_id?) → chain_id`. Cols: `tenant_id`, `capability`, `space_id` (nullable = tenant-wide), `role_id` (nullable = all roles), `chain_id`, `precedence smallint`. | **Schema gap** — F1 §4 mentions "space/role binding" but names no table (§ crate_issues / mockup_gaps). `service_role`-write-only. Uniqueness `(tenant_id, capability, space_id, role_id)`. |
| `routing_policies` **(new — C2 proposes)** | Per-chain (or per-tenant default) resilience policy: `retry_attempts`, `retry_backoff_ms`, `hard_timeout_ms`, `region_pin` (nullable, operator-set — **no hardcoded region**, see mockup_gaps), `health_interval_ms`, `breaker_threshold`, `breaker_timeout_ms`, `breaker_half_open_max`. | Backs the mockup "Routing policy" rows (retry budget / hard timeout / region pin / health check). Maps to `CircuitBreakerConfig` + engine routing policy. `service_role`-write-only. |
| `provider_health` **(new — C2 proposes)** | Per-`(tenant_id, router_id)` health snapshot: `status text` (`healthy`\|`degraded`\|`down`), `breaker_state text` (`closed`\|`open`\|`half_open`), `last_error`, `checked_at`. | Written by C1's health probe / breaker observer (`service_role`); tenant-scoped `SELECT`. Ephemeral truth is in-process; this table is the **queryable/Realtime projection** for W1. |

### 3.2 Used (read-only from C2's perspective)

- `models`, `model_capabilities`, `model_endpoints.local_capable`, `routers`, `providers` — catalog resolution; **capability is an attribute of the model** (DECISIONS §3): a step's behavior derives from its bound model's `model_capabilities`, not the provider.
- Per-tenant **catalog override** tables (RW10) — enable/disable models, custom pricing, `verified` — layered over platform defaults when assembling `ModelConfig`.
- `budget_nodes` / `inference_calls` — **read** the caller's remaining headroom (via C3's spend helpers) to compute `SelectionCriteria.budget`; C2 never writes them.
- `router_credentials` — **never read by C2**; C1 injects decrypted credentials at call time (F3 vault). C2's config carries the router *reference* only.
- `feature_states` / `user_preferences` — 4-state feature governance gates chain selection + which triggers/planes a role may set (DECISIONS §4).

### 3.3 Torii capability → engine `Capability` mapping

The engine `Capability` enum (`kernel::types::capability`) has 11 variants. C2's chain "purpose" maps onto it:

| Torii chain purpose | Engine `Capability` | v1? |
|---|---|---|
| chat / reasoning | `TextChat` | ✅ ("reasoning" is a chat chain whose bound model has a reasoning-grade `model_capabilities` entry — **not** a distinct engine variant) |
| embedding | `TextEmbed` | ✅ (1024-dim model per F1 §9b) |
| rerank | `TextRerank` | ⛔ engine variant is a reserved `Unsupported`; v1 rerank = **separate C5 service**, not an engine chain (GH-8) |
| moderate / vision / image / audio / video | `TextModerate` / `ImageAnalyze` / … | out of v1 C2 scope (catalog may carry them; no v1 chains) |

---

## 4. Contracts

### 4.1 Engine types consumed (from `sensei-kernel` / `sensei-gateway` @ v0.4.6 — verified)

```rust
// kernel::types::config
pub struct ChainEntry { pub model: String, pub router: Option<String>,
                        pub api_model_id: Option<String>, pub priority: u8 }
                        // NO `plane` field today — added by GH-1.
pub struct FallbackChainConfig { pub id: String, pub capability: Capability,
                        pub models: Vec<ChainEntry>, pub fallback_triggers: Vec<FallbackTrigger> }
pub enum FallbackTrigger { RateLimit, Timeout, ProviderError, ModelUnavailable, BudgetExceeded } // exactly 5, serde snake_case
pub struct GatewayConfig { pub routers: HashMap<String, RouterConfig>,
                        pub models: HashMap<String, ModelConfig>,
                        pub chains: HashMap<String, FallbackChainConfig>, /* + constraints/panels/consensus */ }

// gateway::selection
pub struct SelectionCriteria { pub capability: Capability, pub model: Option<String>,
                        pub router: Option<String>, pub chain: Option<String>,
                        pub budget: Option<f64>, pub input_tokens: Option<u32> }
pub struct SelectionResult { pub selected: Option<SelectedModel>, pub all_candidates: Vec<SelectedModel>,
                        pub skipped: Vec<SkippedCandidate>, pub chain: Option<FallbackChainConfig> }
// ModelSelectionService::{select, select_all} — 3-tier resolution: direct model → named chain → capability.

// gateway::budget
pub fn filter_by_budget(models: &[(String, CostEstimate)], budget: f64) -> BudgetFilterResult;
// SOFT affordability partition (estimated <= budget). NOT a concurrency-safe reserve (see GH-4 / §8).

// gateway::circuit_breaker
pub struct CircuitBreakerConfig { pub threshold: usize, pub timeout: Duration, pub half_open_max_requests: usize }
pub struct CircuitBreakerManager { /* can_execute / record_success / record_failure / get_state / reset(_all) */ }
// State is Arc<Mutex<HashMap>> — IN-MEMORY, ephemeral, per-process (§5).

// kernel::types::trace
pub struct Attempt { pub sequence: u8, pub adapter: String, pub model: String, pub api_model_id: String,
                     pub status: AttemptStatus, pub duration_ms: u64, pub tokens: Option<TokenUsage>,
                     pub cost: Option<f64>, pub error: Option<String>, pub fallback_triggered: bool }
                     // NO execution_location field today — added by GH-1.
pub struct ExecutionTrace { pub request_id: String, pub capability: Capability, pub status: TraceStatus,
                     pub candidates: Vec<CandidateInfo>, pub skipped: Vec<SkippedInfo>,
                     pub attempts: Vec<Attempt>, /* estimated/actual cost, created_at */ }
```

### 4.2 HTTP — C1 domain RPC (gateway-mediated writes, DECISIONS §2 W1)

All chain config is privileged → `service_role`-write only, mutated through **per-domain** C1 endpoints that check the `chain.write` capability server-side (never a generic blob, never direct PostgREST). All are tenant-scoped from the JWT; all mutations emit an `audit_events` row (O1).

| Method + path | Capability | Body → effect |
|---|---|---|
| `GET  /v1/routing/chains` | `chain.read` (broad) | List chains for tenant (+ `?capability=`, `?space_id=`). |
| `POST /rpc/routing/upsert-chain` | `chain.write` | Create/update a chain: `{ capability, name, purpose_label, fallback_triggers[], steps:[{model_id,router_id,priority,plane,api_model_id?}], enabled }`. Validates each step's model has the chain's capability in `model_capabilities`; rejects unknown triggers. |
| `POST /rpc/routing/update-chain` | `chain.write` | Update `{id}` metadata / triggers / `enabled` / `is_default`. |
| `POST /rpc/routing/set-steps` | `chain.write` | Reorder / replace `{chain_id}` steps (priority, plane, model, router). |
| `POST /rpc/routing/delete-chain` | `chain.write` | Delete `{id}` (blocked if bound; must rebind or force). |
| `GET /v1/routing/bindings` · `POST /rpc/routing/set-binding` | `chain.read` / `chain.write` | Read / set `chain_bindings` rows for `(capability, space_id?, role_id?)`. |
| `GET /v1/routing/policy/{chain_id}` · `POST /rpc/routing/set-policy` | `chain.read` / `chain.write` | Read / set `routing_policies` (retry/timeout/region-pin/health/breaker). |
| `GET  /v1/routing/health` | `chain.read` | `provider_health` snapshot for the tenant. |
| `POST /v1/routing/simulate` | `chain.read` | **Dry-run** (§4.5) — resolve + rank, no execution. |

**Runtime selection is not a public endpoint** — it happens inside C1's `/v1/chat`·`/v1/embed`·`/v1/generate` request path (C1 spec), which calls the C2 resolver + engine. C2 exposes the *config* surface above and the resolver as an in-process Rust API (§4.4).

### 4.3 Tauri IPC (desktop, via D3)

The desktop app does not mutate chains locally (writes go to C1). It consumes the **resolved chain + plane** to make the local/cloud walk decision and to render badges:

- `invoke("routing_resolved_chain", { capability, space_id })` → `{ chain_id, steps: [{ model, router, plane, priority }], policy }` — the assembled chain the device will walk (D3 flow 3).
- `invoke("routing_simulate", { capability, space_id, remaining_budget })` → same shape as §4.5 dry-run, for the desktop preview.
- Config arrives via the D4 snapshot (no secrets); Realtime invalidation refreshes it.

### 4.4 Rust API (in-process, `services/gateway`)

```rust
/// C2 config-assembly + resolution, layered over sensei-gateway.
pub struct RoutingService { /* db pool, engine ChainRegistry, CircuitBreakerManager */ }

impl RoutingService {
    /// Build the tenant's GatewayConfig (chains/models/routers) from F1 + overrides.
    async fn assemble_config(&self, tenant_id: Uuid) -> Result<GatewayConfig>;

    /// Precedence resolve: explicit override → (space×role) → (space) → (role) → tenant default.
    /// Returns the chosen chain id + its per-step planes (feature-governed).
    async fn resolve_chain(&self, ctx: &AuthContext, capability: Capability,
                           space_id: Option<Uuid>, override_chain: Option<&str>)
        -> Result<ResolvedChain>;

    /// Dry-run: run ModelSelectionService with the given headroom, no execution.
    async fn simulate(&self, ctx: &AuthContext, req: SimRequest) -> Result<SimResult>;

    /// Observe an engine ExecutionTrace → project provider_health + step-served label.
    async fn record_trace(&self, tenant_id: Uuid, trace: &ExecutionTrace);
}
```

### 4.5 Dry-run / simulator response shape

```jsonc
// POST /v1/routing/simulate  { capability, space_id?, chain_id?, remaining_budget?, input_tokens?, simulate_outage?: "router-id" }
{
  "chain_id": "chat-primary",
  "capability": "text_chat",
  "served_by": { "model": "claude-sonnet", "router": "anthropic", "plane": "cloud", "priority": 1 },
  "reason": "primary",              // primary | stepped_down | free_floor | resilience_fallback | budget_blocked
  "candidates": [                   // ordered; mirrors SelectionResult.all_candidates + plane
    { "model": "claude-sonnet", "router": "anthropic", "plane": "cloud", "priority": 1,
      "est_cost": 0.012, "within_budget": true, "breaker": "closed" }
  ],
  "skipped": [                      // mirrors SelectionResult.skipped
    { "model": "gpt-4o", "router": "openai", "reason": "circuit_open" }
  ]
}
```

### 4.6 Events

- **`chain.config.changed`** (Realtime, RLS-scoped) — on any chain/binding/policy mutation → invalidates C1 config cache + D4 device snapshot.
- **`provider.health.changed`** (Realtime) — breaker transition / probe result → updates W1 health surface + D3 locality hints.

---

## 5. Security & RLS

- **Gateway-mediated writes (DECISIONS §2 W1).** `fallback_chains`, `fallback_chain_models`, `chain_bindings`, `routing_policies` are **`service_role`-write-only**: `authenticated`/`anon` `INSERT/UPDATE/DELETE` are REVOKEd. All mutations flow through the C1 domain RPC (§4.2), which checks the **`chain.write`** capability (from F2's resolved capability set, §RBAC default) server-side. A member cannot rebind a space's chain to a costlier/cloud-only model, disable a step's plane, or widen triggers without the capability.
- **Read.** `authenticated` gets tenant-scoped `SELECT` (`tenant_id = (auth.jwt()->>'tenant_id')::uuid`) on chains/bindings/policies/`provider_health` so the W1 editor and W2/W3 badges render; further narrowing by capability where a chain is space-restricted.
- **Tenant isolation.** Every C2 table is `tenant_id`-first with composite FK `(tenant_id, chain_id)`; the resolver always filters by the JWT `tenant_id`; the service role bypasses RLS and C1 re-scopes in code (F1 §5).
- **Capability = model attribute (not provider).** Chain validation checks the *bound model's* `model_capabilities`, so no provider is hardwired to a capability (DECISIONS §3, [[project-gateway-no-hardcoded-ops]]).
- **No secrets in C2.** C2 config references routers by id only; `router_credentials` decryption is C1/F3-only and never enters `GatewayConfig` until C1 injects it at call time. `RouterConfig`'s `Debug` already redacts `api_key` — C2 must not log assembled configs at a level that dumps injected keys (rely on the crate's redacting `Debug`, never `{:#?}` a post-injection config into logs).
- **No hardcoded ops.** Region pin, retry budget, timeouts, breaker thresholds, model ids, and triggers are **operator config** in `routing_policies`/`fallback_chains` — the mockup's `eu-west-2 only` / `2 attempts · 800ms` / `30s` are illustrative defaults, not baked constants (mockup_gaps). Consts may exist only as overridable fallbacks.
- **Circuit-breaker state is per-process & ephemeral** (`Arc<Mutex<HashMap>>`). In a multi-instance C1 deployment each instance keeps its own breaker; this is acceptable for v1 (each instance self-heals, and an open breaker on one instance still trips others fast on the same failing provider). The **`provider_health` projection** is the shared, queryable truth; a shared/distributed breaker is post-v1 (open question). Breaker state must **not** be trusted as a security control — it is availability-only.
- **Feature governance.** Which chains/planes/triggers a role may select or edit is gated by the 4-state feature model (workspace→space→role→user, DECISIONS §4); a `locked` routing feature cannot be overridden by a user preference.

---

## 6. Key flows

**Flow 1 — Chain resolution (per request, in C1's hot path).**
1. C1 authenticates the caller (RS256/JWKS) → `tenant_id` + capabilities + `space_id` (F2).
2. `RoutingService::resolve_chain` picks the chain by precedence: **explicit request `chain` override** (only if the caller has `chain.read` and the chain is bound-visible) → **(space × role)** binding → **(space)** binding → **(role)** binding → **tenant default** (`fallback_chains.is_default` for that capability). Feature governance may force/forbid a chain.
3. Resolver returns the `FallbackChainConfig` (engine) plus the per-step `plane[]` (Torii side-channel until GH-1 folds `plane` into `ChainEntry`).

**Flow 2 — Budget-filtered selection + graceful step-down (central).**
1. C3 supplies the caller's **remaining headroom** (min across the org→dept→team→user path); C2 sets it as `SelectionCriteria.budget`.
2. The engine's `ModelSelectionService::select_all` produces ordered candidates; `filter_by_budget` partitions affordable vs over-budget (soft). The circuit breaker's `can_execute` drops open-circuit candidates (recorded as `skipped: circuit_open`).
3. Selection order realizes the mockup's ladder: **primary** (headroom OK) → **stepped-down** cheaper model (under pressure) → **free floor** (local/`$0` step at zero headroom, `BudgetExceeded` trigger) → or, on provider failure, **resilience fallback** (next `priority` via `RateLimit`/`Timeout`/`ProviderError`/`ModelUnavailable`).
4. **Hard cap is enforced by C3's reserve, not by C2** (§8): before executing the chosen step, C1/C3 does the concurrency-safe `reserve`; C2's affordability filter only *orders* candidates. On reserve failure the resolver is asked for the next affordable/free-floor step.
5. C1 executes; `record_trace` projects `provider_health` and the `served_by.reason` label.

**Flow 3 — Split-plane chain walk (desktop, D3).**
1. D3 gets the resolved chain + per-step `plane` (§4.3). It walks steps in `priority` order.
2. A `local` step runs in-process (D2 embedded engine, `$0`); a `cloud` step proxies to C1 (device token + JWT; C1 runs the device-status check). Provider credentials never touch the device.
3. Attempts merge into one unified `ExecutionTrace` with per-step `execution_location` (GH-1); local calls are logged to `inference_calls` at `$0` so budgets stay unified (D3/O1).

**Flow 4 — Circuit breaking.**
1. Per attempt, C1 calls `CircuitBreakerManager::can_execute(router_endpoint)`; on success/failure it records the outcome.
2. `threshold` consecutive failures → `Open` for `timeout` → `HalfOpen` probe → `half_open_max_requests` successes → `Closed`. Config comes from `routing_policies` (defaults: threshold 5, timeout 300s, half-open 3 — the crate defaults, overridable).
3. Open circuits are surfaced via `provider.health.changed` → `provider_health` → W1 health list + selection `skipped` reasons.

**Flow 5 — Editing a chain (W1, gateway-mediated).**
1. Admin opens the (now editable) Routing screen; W1 loads chains/bindings/policy + a `simulate` dry-run.
2. On save, W1 calls the C1 domain RPC (§4.2); C1 checks `chain.write`, validates model↔capability + trigger set, writes as `service_role`, emits an audit row, and fires `chain.config.changed`.
3. C1 config cache + D4 device snapshots invalidate; the simulator re-renders with the new resolution.

---

## 7. Gateway-crate dependencies

Consumes `sensei-gateway` + `sensei-kernel` @ pinned `v0.4.6` (dev-in-place via `[patch]`; see [[project-gateway-crate]], [[feedback_gateway_release_flow]]). Reused: `selection.rs` (`ModelSelectionService`, `SelectionCriteria`, `SelectionResult`), `budget.rs` (`filter_by_budget`), `circuit_breaker.rs` (`CircuitBreakerManager`/`Config`), `config.rs` (`GatewayConfig`/`FallbackChainConfig`/`ChainEntry`/`FallbackTrigger`), `trace.rs` (`ExecutionTrace`/`Attempt`).

**Blocking crate issue — [GH-1] per-step `plane` + execution-location on the trace** ([`../plans/gateway-issues.md`](../plans/gateway-issues.md)). **Confirmed absent in v0.4.6:** `ChainEntry` (config.rs) has no `plane`; `Attempt`/`ExecutionTrace` (trace.rs) have no execution-location. GH-1 adds `plane: Plane` to `ChainEntry` and an execution-location field to `Attempt`/`ExecutionTrace`. **Sequenced before the C2 / D3 phase.** Until it lands, C2 carries `plane` as a DB column + a resolver side-channel (usable for CRUD/simulation), but the unified split-plane *trace* (D3/O1 `execution_location`) cannot be recorded — so C2's plane-in-trace work waits on GH-1.

**Related (non-blocking for C2 core):**
- **[GH-4] hard reserve.** `filter_by_budget` is **soft affordability-only** (verified: `estimated <= budget`, no lock). The crate cannot do a concurrency-safe pre-call reserve. **Decision: no crate change for C2** — the hard reserve→commit is implemented **consumer-side in C1/C3 against `inference_calls`** (DECISIONS §2 W2). C2 only feeds the affordability signal.
- **[GH-8] `RerankModel` trait — deferred.** `TextRerank` is a reserved `Unsupported` variant; v1 rerank runs as a **separate C5 service**, not a C2 engine chain. A rerank *chain shape* is design-only until a later optional crate issue lands the trait.

C2 files **no new** gateway issue; it depends on GH-1 (owned by the C2/D3 phase) and references GH-4/GH-8.

---

## 8. Decisions resolved

Settling C2's residual questions per the RESOLVED ARCHITECTURE DEFAULTS:

1. **Every capability is a chain; capability is per-model.** Chat/reasoning and embedding are each a `fallback_chains` row (engine `TextChat`/`TextEmbed`); the same fallback/breaker/plane machinery applies to embedding chains as to chat chains. A step's behavior derives from its **bound model's `model_capabilities`**, never from the provider (DECISIONS §3). "Reasoning" is a chat chain with a reasoning-grade model, **not** a distinct engine `Capability`. *Rationale: matches the ratified "capabilities are chain-managed / capability is a model attribute" decision and the crate's single `TextChat` variant.*
2. **Chain binding precedence** = explicit override → (space×role) → (space) → (role) → tenant default, feature-governed. *Rationale: most-specific-wins mirrors the feature-governance ladder (workspace→space→role→user) and the RBAC matrix; keeps a sane tenant default so no capability is unroutable.*
3. **Hard reserve is consumer-side (C1/C3), not C2.** C2's budget role is limited to feeding remaining headroom into the engine's soft `filter_by_budget` for ordering/step-down; the concurrency-safe reserve→commit on `hard` nodes lives in C1/C3 against `inference_calls` (DECISIONS §2 W2, GH-4). *Rationale: the crate filter is affordability-only (verified); hard caps must not depend on selection ordering.*
4. **Per-step plane** is a DB column (`fallback_chain_models.plane`) + resolver side-channel now, folding into `ChainEntry`/trace once **GH-1** lands; C2 is sequenced after GH-1. *Rationale: GH-1 confirmed as the real, blocking gap; D3/O1 need it in the trace.*
5. **FallbackTrigger set** = exactly the 5 engine variants (`RateLimit`, `Timeout`, `ProviderError`, `ModelUnavailable`, `BudgetExceeded`); the W1 editor exposes **only these** as per-chain toggles — no custom/synthetic triggers in v1. *Rationale: don't expose an editor control the engine can't honor.*
6. **Circuit-breaker state stays per-process/in-memory** for v1; the shared truth for UI/analytics is the `provider_health` projection. *Rationale: matches the crate's ephemeral `CircuitBreakerManager`; per-instance breakers self-heal and still trip fast; a distributed breaker is unjustified complexity for v1.*
7. **Region pin / retry / timeout / health interval / breaker thresholds are operator config** in `routing_policies`, not constants. *Rationale: [[project-gateway-no-hardcoded-ops]] — the mockup's `eu-west-2`/`2 attempts`/`30s` are defaults, not baked ops.*
8. **Rerank chain = C5 service, not a C2 engine chain, in v1** (GH-8). *Rationale: `TextRerank` is `Unsupported` in the engine.*
9. **Simulator is read-only dry-run in C2; the editable editor is W1.** C2 exposes `/v1/routing/simulate` + the config RPC; W1 renders the editor and simulator on top. *Rationale: separation of the data/dry-run contract (C2) from the UI (W1), consistent with "read-only screen → editable editor" in DECISIONS §6.*

---

## 9. Acceptance criteria (observable, testable)

1. **Config assembly.** Given a tenant with chains in F1, `assemble_config` produces a `GatewayConfig` whose `chains` keys, `models`, and `routers` match the DB (incl. per-tenant catalog overrides applied); a disabled model/router is absent.
2. **Chain resolution precedence.** Given bindings at tenant / role / space / space×role for one capability, `resolve_chain` returns the most-specific bound chain; with none, it returns the capability's tenant default; with no default, a deterministic error (not a silent wrong chain).
3. **Capability↔model validation.** Creating a chain whose step's model lacks the chain's capability in `model_capabilities` is **rejected** by the C1 RPC (400 + reason); no invalid step persists.
4. **Gateway-mediated write enforcement.** A JWT lacking `chain.write` that attempts any `POST /rpc/routing/*` write gets 403; a direct PostgREST `UPDATE fallback_chains` by `authenticated` is denied by RLS; the same mutation via `service_role` (C1) succeeds and writes one `audit_events` row.
5. **Cross-tenant isolation.** A tenant-A JWT reading `/v1/routing/chains` never sees tenant-B chains; a cross-tenant `chain_id` in any RPC returns 404/0-rows.
6. **Budget step-down.** With decreasing `remaining_budget`, `simulate` returns `served_by.reason` transitioning `primary → stepped_down → free_floor`; at zero headroom the served step's plane is `local`/price `$0`; over-budget candidates appear in `skipped`/`candidates.within_budget=false`.
7. **Resilience fallback.** With `simulate_outage=<router>`, the served model is the next-priority step whose router isn't the outaged one, and the outaged router's candidates are `skipped` with reason `circuit_open`/`provider_error`.
8. **Circuit breaker.** After `threshold` recorded failures for a router endpoint, `can_execute` returns false and `provider_health.status` flips to `degraded`/`down` + `breaker_state=open`; after `timeout` it half-opens; `half_open_max` successes close it and health returns `healthy`. Independent endpoints don't interfere.
9. **Trigger set fidelity.** The chain editor payload only accepts the 5 engine triggers; an unknown trigger string is rejected; the stored `fallback_triggers` round-trip into `FallbackChainConfig.fallback_triggers` unchanged (serde snake_case).
10. **Per-step plane (post-GH-1).** A chain `[opus(cloud) → sonnet(cloud) → gemma(local)]` resolves with correct `plane` per step; D3's `routing_resolved_chain` IPC returns those planes; the executed `ExecutionTrace.attempts[*]` carry `execution_location` matching the step plane; a local step logs an `inference_calls` row at `$0`.
11. **Simulator = no execution.** `/v1/routing/simulate` produces candidates/skips/est-cost/plane and records **no** `inference_calls` row and makes **no** provider call.
12. **Config-change propagation.** A chain mutation fires `chain.config.changed`; C1's next request uses the new resolution without restart; a subscribed desktop client's D4 snapshot invalidates.
13. **No secret leakage.** Assembled/logged configs never emit a provider credential (verified by asserting redaction in the log path; `router_credentials` is never SELECTed by C2).

---

## 10. Open questions (genuine)

1. **Distributed circuit breaker.** v1 keeps per-process breakers + a `provider_health` projection. If C1 scales to many instances against the same provider, is per-instance self-healing acceptable, or do we want a shared breaker (Realtime/DB-backed) in v1.x? (Resolved as per-instance for v1 — flagged for revisit under load.)
2. **Region-pin enforcement mechanism.** `region_pin` is stored config, but *how* it's enforced (route to a region-specific C1 deployment vs. select a provider region vs. reject) depends on the C1 multi-region topology, which is itself open (C1 §Open questions). C2 stores + surfaces the pin; enforcement binding TBD with C1 deployment.
3. **Reasoning selection signal.** "Reasoning" is a chat chain today. If we later want the router to *prefer* reasoning-grade models by a request hint (not just a bound chain), do we add a `model_capabilities` sub-tier the selector reads, or keep it purely chain-bound? (v1: purely chain-bound.)
4. **`chain_bindings` / `routing_policies` / `provider_health` are C2-proposed tables** not named in the built F1 or the F1-rework plan. They must be folded into the F1 rework (or an addendum) before the C2 phase builds — confirm ownership + exact columns with F1.
