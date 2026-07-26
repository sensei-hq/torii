# C1 · Gateway service & API — Spec

**Module:** [C1](../modules/C1-gateway-service.md) · **Status:** Planned (service scaffolded 2026-07 under superseded crate/auth assumptions — **rework + extend**) · **Plane:** Central
**Depends on:** [F1](F1-data-model.md) (schema + ledger + RLS), [F2](../modules/F2-identity-auth-rbac.md) (JWT/JWKS + RBAC matrix + device lifecycle), [F3](../modules/F3-key-vault.md) (credential vault — **must land before real credentials**) · engine crates `sensei-*` @ `v0.4.6`
**Enables:** [C2](../modules/C2-routing-resilience.md), [C3](../modules/C3-budgets-metering.md), [C4](../modules/C4-governance-runtime.md), [C5](../modules/C5-rag-document-intelligence.md), [O1](../modules/O1-ledger-audit.md)/[O2](../modules/O2-analytics.md), and every web/desktop client surface (W1/W2/W3, D3 split-plane router)
**Date:** 2026-07-23 · **Language:** Rust · **Framework:** Axum 0.8 · **Runtime:** container behind Cloudflare at `api.` (local dev `127.0.0.1:8787`)

---

> ⚠️ **Reconciliation banner (2026-07-23).** A `services/gateway` Axum crate exists from Phase 2a but was written against the **pre-`v0.4.6`** crate (`gateway::adapters::{AdapterRegistry, InferenceAdapter}`, per-adapter `register()`) and a **deferred F3 / env-key** posture. Per [`../DECISIONS.md`](../DECISIONS.md) this spec is the ratified target. The first build task is the **crate migration (MIG-1/2/3)**; everything else (privileged-write RPC, API-key identity auth, device-status check, F3 credential injection, budget reserve→commit) layers on top. Where the built service disagrees with this spec, **this spec wins**.

---

## 1. Purpose & scope

C1 is the central **HTTP authority** for all cloud (BYOK) inference and the **sole gateway-mediated write path** for privileged data. It wraps the `sensei-gateway` engine (`v0.4.6`) and is the only process that:

1. **Verifies** every caller — Supabase RS256/JWKS JWTs (humans) **or** `api_keys` (programmatic identities) — and resolves them to a **tenant + identity + capability set**.
2. **Serves inference** — `/v1/chat` (+ SSE), `/v1/embed`, `/v1/compare` (panels/consensus), `/v1/generate` — by assembling `GatewayConfig` from the F1 catalog/routing tables, injecting decrypted provider credentials from the F3 vault, and calling the engine.
3. **Enforces spend** — a concurrency-safe **reserve → commit** against the `service_role`-only `inference_calls` ledger before/after each call (cascade owned by C3).
4. **Mediates privileged writes** — per-domain **REST write endpoints** (`/v1/<domain>/<resource>`, DECISIONS §5a) that check capabilities server-side and are the only writer for privileged F1 tables (roles, budgets, chains, connections, governance, spaces, mcp, apikeys).
5. **Persists** — implements the engine's `GatewayStore` trait against Postgres (`inference_calls` + `execution_traces`), feeding C3/O1/O2.

**In scope:** the Axum service, auth middleware (JWT + API-key), the request-context resolution (tenant/identity/capabilities/device), endpoint handlers, `GatewayConfig` assembly, credential injection, the reserve→commit budget hook, the `GatewayStore` impl, and the privileged-write authz surface.

**Out of scope (owned elsewhere, called by C1):** the budget cascade math + `budget_requests` (C3); the guardrail/redaction pipeline that wraps `execute`/`execute_stream` (C4); the RAG retrieval/embedding pipeline (C5); chain CRUD business rules (C2 — C1 exposes the `/v1/routing/chains` write surface); the credential vault crypto + OAuth refresher (F3); the JWT-claims hook + RBAC matrix authoring (F2); the DDL/RLS (F1). Multi-region/residency deployment topology is deferred (see §10).

---

## 2. Responsibilities

- Terminate and authenticate client requests (JWT or API key), reject unauthenticated/expired/revoked callers.
- Resolve a **request context** — `tenant_id`, `identity` (person `profile_id` **or** `service_account_id`), resolved **capabilities**, budget node(s), device status — from the credential; never trust client-supplied tenant/identity/role.
- Perform a **per-request device-status check** on the inference hot path (revoked device with a live JWT cannot keep spending).
- Assemble the engine `GatewayConfig` from F1 (`config.routers`/`config.models`/`config.model_endpoints`/`public.fallback_chains`/`fallback_chain_models`), refresh on config change.
- Inject decrypted provider credentials from F3 (`router_credentials`: `api_key` secret **or** OAuth bearer) via `refresh_router_keys` at call time — credentials never reach the client.
- Run the **budget reserve → commit** around every metered call; block on `hard` cap; allow bounded overshoot + alert on `soft`.
- Invoke the C4 governance/redaction wrapper around `execute`/`execute_stream` before egress.
- Enforce the MCP per-(role×space) tool allow-list at tool-call time (X1 registry).
- Persist each call + trace to the single `inference_calls` ledger with org→dept→team→user attribution.
- Be the **only** writer of privileged F1 tables via capability-checked domain-RPC endpoints.
- Expose health/readiness for the platform LB.

---

## 3. Data model (F1 tables owned / used)

C1 owns **no schema of its own** beyond the two ledger tables; it is the principal **runtime writer** (as `service_role`) of the F1 rework tables. See [`F1-data-model.md`](F1-data-model.md) and [`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md).

### 3.1 Owned (C1 is the DDL author + sole writer)

| Table | Role | Notes |
|-------|------|-------|
| `public.inference_calls` | **Single authoritative ledger** (RW7/GH-5) | `service_role`-write-only. Crate `GatewayStore` shape (`InferenceCall`) + denormalized **org→dept→team→user node attribution** columns (`org_node_id`, `dept_node_id`, `team_node_id`, `user_node_id`, or a single `subject_node_id` + rollup path) so a row rolls up the budget tree. `gateway_tasks` cost/metering fields **retired**. Backs C3 spend + O1/O2. |
| `public.execution_traces` | **Per-call trace** | `service_role`-write-only. Stores the engine `ExecutionTrace` JSON (attempts, fallbacks, circuit-breaker, per-step `plane`/execution-location once GH-1 lands). FK `(tenant_id, inference_call_id) → inference_calls`. |
| `public.budget_holds` | **Reserve ledger** (RW7) | `service_role`-only. One row per in-flight `reserve` (`hold_id`, `tenant_id`, `subject_node_id`, `reserved_amount`, `status reserved\|committed\|released`, `created_at`, `expires_at`). Lets a crashed/timed-out reserve be swept. (If C3 folds holds into `inference_calls` with a `reserved` status, C1 uses that instead — coordinate at RW7.) |

### 3.2 Read (as `service_role`, to build config + resolve context)

`config.routers`, `config.models`, `config.model_endpoints`, `config.model_capabilities`, `config.capabilities`, catalog **override** tables (RW10), `public.fallback_chains`, `public.fallback_chain_models` (+ `plane`), `public.router_credentials` (F3 — decrypt only here), `core.tenants`, `core.profile_tenants`, `roles`/`role_permissions`/`profile_roles` (RW2 — resolve capabilities), `budget_nodes` (RW7), `service_accounts`/`api_keys` (RW4 — validate keys), `devices` (device-status check), `mcp_servers`/`tenant_mcp_servers`/`tool_allow_lists` (RW3), `spaces`/`space_members` (RW9 scoping), `settings`/`feature_states`/`user_preferences` (RW6 — governance resolution passed to C4).

### 3.3 Written via domain-RPC (as `service_role`, capability-checked)

`budget_nodes` + `budget_requests`, `roles`/`role_permissions`/`profile_roles`, `fallback_chains`/`fallback_chain_models`, `router_credentials`, governance/`settings`/`feature_states`, `spaces`/`space_members`, `mcp_servers`/`tenant_mcp_servers`/`tool_allow_lists`, `api_keys`/`service_accounts`. (Ownership of the *business rules* stays with the domain module; C1 owns the *authz + write*.)

> **Ledger shape (GH-5).** The crate's `GatewayStore` already exposes `get_usage_since(subject, window)` (a subject-scoped rollup) alongside `get_spend_since`/`get_spend_by_model_since`. Confirm at MIG time whether `InferenceCall` carries a `subject`/attribution field; if not, GH-5 extends it and C1's ledger columns mirror the extension. Do **not** invent a parallel spend table — `inference_calls` is the one ledger.

---

## 4. Contracts

All engine imports use the **lib name `gateway`** (package `sensei-gateway`); the `v0.4.6` package names are `sensei-gateway`/`sensei-kernel`/`sensei-cloud-providers`/`sensei-local-*`/`sensei-kokoro`.

### 4.1 HTTP — inference endpoints (auth required: JWT **or** API key)

| Method + path | Purpose | Capability | Notes |
|---|---|---|---|
| `POST /v1/chat` | Single chat/reasoning completion | none beyond authenticated identity + budget headroom | Resolves chain by capability `TextChat`. |
| `POST /v1/chat/stream` | Streaming chat (SSE) | as above | `text/event-stream`; one `Event` per `StreamChunk`; final `done` event carries usage/cost; persist after stream ends. |
| `POST /v1/embed` | Embeddings (1024-dim) | as above | Capability `TextEmbedding`; resolves the **embedding chain** (chain-managed, per DECISIONS §3). |
| `POST /v1/compare` | Multi-model panel / consensus | as above | Backed by engine `execute_panel` / `execute_consensus`; `mode: "panel" \| "consensus"`. |
| `POST /v1/generate` | Non-chat generation (image/audio where a chain exists) | as above | Capability derived from the named chain's bound model. |
| `GET /v1/status` | Assembled config summary | authenticated | `{ configured, adapters[], models[], chains[] }`. |
| `GET /v1/whoami` | Resolved caller context (debug/UI) | authenticated | `{ tenant_id, identity: {kind, id}, capabilities[], device_status }`. |
| `GET /health` | Liveness (no auth) | — | `{ "status": "ok" }`. |
| `GET /ready` | Readiness (no auth) | — | 200 only when pool + engine `is_configured()` + JWKS loaded; else 503. |

**`POST /v1/chat` request:**
```jsonc
{
  "messages": [{ "role": "user", "content": "..." }],
  "system": "optional system prompt",
  "chain": "chat",            // OR "model": "<catalog model id>"
  "max_tokens": 1024,
  "space_id": "uuid|null",    // scopes governance + retrieval + tool allow-list
  "conversation_id": "uuid|null"
}
```
**`POST /v1/chat` response:**
```jsonc
{
  "content": "…",
  "model": "claude-…",
  "adapter": "anthropic",
  "usage": { "input_tokens": 12, "output_tokens": 34 },
  "cost_usd": 0.000123,
  "execution_location": "cloud",   // "local" only via D3
  "inference_call_id": "uuid",
  "trace_id": "uuid"               // resolves the "why this model" trace (C4/O1)
}
```
Errors are RFC-7807-ish JSON `{ error, code, detail }` with mapped HTTP status (§6.6).

### 4.2 HTTP — gateway-mediated privileged writes (REST `/v1/<domain>/<resource>`)

Per-domain, **not** a generic blob (DECISIONS §5a — privileged/gateway-mediated **writes** are the control plane `POST /rpc/<domain>/<action>`; inference + reads are `/v1/...`). Each endpoint verifies the caller's capability server-side (from resolved claims, never from the body), performs the write as `service_role`, and emits an `audit_events` row via C4. All are tenant-scoped from the caller context; resource-owning specs (C2/C3/C4/F2/X1) define the detailed request/response shapes. All privileged writes are `POST` (action semantics); ids travel in the body.

| Endpoint (`POST`) | Capability | Writes (F1) |
|---|---|---|
| `/rpc/budgets/upsert-node`, `/rpc/budgets/delete-node` | `budget.write` | `budget_nodes` (C3 §4.1) |
| `/rpc/budgets/request-increase` | *(any member)* | `budget_requests` (INSERT own request) |
| `/rpc/budgets/approve-request`, `/rpc/budgets/reject-request` | `budget.write` | `budget_requests` → `budget_nodes.cap_amount` |
| `/rpc/rbac/create-role`, `/rpc/rbac/update-role`, `/rpc/rbac/delete-role`, `/rpc/rbac/assign-role`, `/rpc/rbac/unassign-role` | `role.manage` | `roles`, `role_permissions`, `profile_roles` (F2 §4.6) |
| `/rpc/routing/upsert-chain`, `/rpc/routing/update-chain`, `/rpc/routing/set-steps`, `/rpc/routing/set-binding`, `/rpc/routing/set-policy`, `/rpc/routing/delete-chain` | `chain.write` | `fallback_chains`, `fallback_chain_models`, `chain_bindings`, `routing_policies` (C2 §4.1) |
| `/rpc/connections/upsert`, `/rpc/connections/rotate`, `/rpc/connections/revoke`, `/rpc/connections/oauth-start`, `/rpc/connections/oauth-callback` | `connection.manage` | `router_credentials` (crypto → F3; adapter bearer support → GH-2) |
| `/rpc/governance/set-masking-policy`, `/rpc/governance/set-classification-labels`, `/rpc/governance/set-grounded-only`, `/rpc/governance/set-feature` | `governance.manage` / `feature.manage` | `settings`, `feature_states` (4-state), governance policy tables (C4 §4.x) |
| `/rpc/spaces/create`, `/rpc/spaces/update`, `/rpc/spaces/add-member`, `/rpc/spaces/remove-member`, `/rpc/documents/declassify` | `space.create`/`member.manage`/`doc.declassify` | `spaces`, `space_members`, `documents.classification` |
| `/rpc/mcp/register-server`, `/rpc/mcp/set-enablement`, `/rpc/mcp/set-allow-list`, `/rpc/mcp/refresh-tools` | `mcp.manage` | `mcp_servers`, `tenant_mcp_servers`, `mcp_server_tools`, `tool_allow_lists` (X1 §4.1) |
| `/rpc/apikeys/create`, `/rpc/apikeys/rotate`, `/rpc/apikeys/revoke`, `/rpc/service-accounts/create` | `apikey.manage` | `api_keys`, `service_accounts` (+ `budget_nodes` leaf `kind='service'`) |
| `/rpc/models/enable`, `/rpc/models/set-pricing` | `model.manage` | catalog override tables (RW10: `model_overrides`/`provider_overrides`) |

> **Capability vocabulary is F2-owned.** The slugs above (`budget.write`, `chain.write`, `space.create`, `space.join`, `doc.declassify`, `member.manage`, `role.manage`, `connection.manage`, `mcp.manage`, `governance.manage`, `apikey.manage`, `model.manage`, `feature.manage`) reference the canonical set in F2/`role_permissions`; C1 does **not** define new ones — if an endpoint needs a capability not in the F2 set, raise it against F2.

**API-key issuance response is reveal-once:**
```jsonc
// POST /rpc/apikeys/create  (only response that ever contains the secret)
{ "id": "uuid", "prefix": "sk_str_live_a1b2", "secret": "sk_str_live_a1b2.<...>", "identity": { "kind": "service_account", "id": "uuid" } }
```
Subsequent reads return `prefix` + metadata only; the raw secret is never stored (hash only) or re-returned.

### 4.3 Rust — engine surface consumed (from `sensei-gateway` / `sensei-kernel`)

```rust
// Engine (crates/gateway/src/engine.rs) — methods C1 calls:
Gateway::execute(&self, req: &InferenceRequest) -> Result<InferenceResponse, GatewayError>
Gateway::execute_stream(&self, req) -> Result<impl Stream<Item = StreamChunk>, GatewayError>
Gateway::execute_panel(&self, ...) -> Result<PanelResponse, GatewayError>       // /v1/compare mode=panel
Gateway::execute_consensus(&self, ...) -> Result<ConsensusResult, GatewayError>  // /v1/compare mode=consensus
Gateway::with_store(self, store: Arc<dyn GatewayStore>) -> Self
Gateway::refresh_router_keys<F: Fn(&str)->Option<String>>(&self, resolver: F)
Gateway::update_config(&self, config: GatewayConfig) / try_update_config(...)
Gateway::is_configured(&self) -> bool
Gateway::list_adapters() / list_models() / list_models_for_router(...)

// GatewayStore trait (crates/gateway/src/store.rs) — PgGatewayStore implements ALL:
async fn insert_inference_call(&self, call: &InferenceCall) -> Result<Uuid, GatewayError>;
async fn get_inference_calls_by_session(&self, session_id: Uuid) -> Result<Vec<InferenceCall>, _>;
async fn get_spend_since(&self, since: DateTime<Utc>) -> Result<f64, _>;
async fn get_spend_by_model_since(&self, since) -> Result<Vec<(String, f64)>, _>;
async fn get_usage_since(&self, subject, since) -> Result<..., _>;   // subject/node rollup (GH-5)
async fn insert_execution_trace(&self, trace: &StoredTrace) -> Result<Uuid, _>;
async fn get_execution_trace(&self, id) -> Result<Option<StoredTrace>, _>;
async fn get_traces_by_call(&self, inference_call_id) -> Result<Vec<StoredTrace>, _>;
```
Models expose the **capability traits** `ChatModel`/`EmbedModel`/… — the old `InferenceAdapter` is **deleted** (MIG-2). Adapter registration uses the `v0.4.6` `AdapterRegistry` + `RegisterInto`/capability-trait model, not per-adapter `register(Arc<dyn InferenceAdapter>)`.

### 4.4 Rust — C1-internal traits/types

```rust
/// Resolved once per request by the auth middleware; the single source of authz truth.
pub struct RequestContext {
    pub tenant_id: Uuid,
    pub identity: Identity,              // Person(profile_id) | Service(service_account_id)
    pub capabilities: HashSet<Capability>,   // resolved server-side from role_permissions
    pub budget_subject_node: Uuid,       // the node spend accrues to (identity's leaf)
    pub device: Option<DeviceStatus>,    // Some for JWT callers; checked on hot path
    pub space_id: Option<Uuid>,
    pub claims_version: i64,
}
pub enum Identity { Person(Uuid), Service(Uuid) }

/// Budget hook (C3 owns the cascade; C1 owns the call sites).
#[async_trait] pub trait BudgetGuard {
    async fn reserve(&self, node: Uuid, est_cost: f64) -> Result<HoldId, BudgetError>; // FOR UPDATE on path
    async fn commit(&self, hold: HoldId, actual_cost: f64) -> Result<(), BudgetError>;
    async fn release(&self, hold: HoldId) -> Result<(), BudgetError>;
}

/// Governance wrapper (C4 owns the impl; C1 calls it around execute/execute_stream).
#[async_trait] pub trait GovernanceGate {
    async fn pre(&self, ctx: &RequestContext, req: &mut InferenceRequest) -> Result<(), PolicyError>;   // redact-in-flight, classification, injection
    async fn post(&self, ctx: &RequestContext, resp: &mut InferenceResponse) -> Result<(), PolicyError>;
}

/// Capability check helper used by every privileged-write handler.
fn require(ctx: &RequestContext, cap: Capability) -> Result<(), ApiError>;
```

### 4.5 Events

- On every completed call: write `inference_calls` + `execution_traces` (feeds O1/O2, C3 rollup).
- On privileged write / policy hit / redaction: C4 emits `audit_events` (`actor_id` = resolved identity).
- On `soft` overshoot or threshold breach: emit an `alert_events` row (C3/O1 dispatch).
- Config-change RPCs trigger `Gateway::update_config` (or a targeted reload) so the running engine picks up new chains/models/credentials.

---

## 5. Security & RLS

- **JWT verification (RS256/JWKS, DECISIONS §2 W3).** C1 fetches the Supabase **JWKS** at startup and caches it; verify-only asymmetric public key, `alg=RS256`, expected `aud=authenticated`, `exp`/`nbf` enforced. On a `kid` miss, refetch the JWKS once (rotation). **No HS256 shared secret** — the Phase-2a HS256 path is removed. A leaked config cannot forge tokens.
- **Capabilities resolved server-side (DECISIONS default).** The JWT carries `tenant_id` + `role_ids` (+ a `claims_version`). C1 resolves the **capability set** from `role_permissions` server-side (keeps the JWT bounded); it never trusts a client-supplied capability/role/tenant. RLS uses a `SECURITY DEFINER` helper that resolves a user's capabilities/roles for predicate checks.
- **API-key auth → identity (DECISIONS §1 #2, §2 W2).** A presented key `sk_str_<env>_<prefix>.<secret>` is split on `.`; C1 looks up by `prefix`, verifies the `secret` against `hashed_secret` (argon2/bcrypt, constant-time), checks `status='active'` + rate limit, and resolves the **identity** (person or `service_account`) the key authenticates. **Budget comes from the identity's node, not the key**; multiple keys for one identity share that identity's budget. Revoked key → 401.
- **Tenant isolation.** `service_role` bypasses RLS, so C1 enforces `tenant_id` in code from the validated context on **every** query, and the `PgGatewayStore { tenant_id }` scopes all ledger writes. Cross-tenant access is impossible because the tenant is taken from the verified credential, never the request body. Privileged `/v1` writes are additionally constrained to the caller's tenant.
- **Gateway-mediated writes (DECISIONS §2 W1).** Privileged tables are `service_role`-write-only; `authenticated`/`anon` have tenant-scoped `SELECT` + self-owned benign writes only. Every privileged mutation flows through a `/v1/<domain>/<resource>` write handler that `require(ctx, cap)` checks before writing. No direct PostgREST write to a privileged table can succeed (F1 RLS + this path close role self-escalation, self budget-raise, confidential self-join, classification downgrade, audit forgery).
- **Device-status check on the hot path.** For JWT callers, C1 checks `devices.status` (short-TTL cache, Realtime-invalidated) before admitting a metered call; a revoked device with a still-live JWT is rejected (`403 device_revoked`) so it **cannot keep spending**.
- **Secrets & credential custody (DECISIONS §2 W4).** Provider credentials (`router_credentials`) are decrypted **only** inside C1 at call time via the F3 DEK/KEK envelope; the plaintext key/token never enters a response, log, trace, or error. F3 must land before C1 handles any real credential; production KEK lives in a cloud KMS/HSM (`STRATEGOS_KEK` is local-dev only). Startup logs *counts* of resolved credentials, never values.
- **Redaction (DECISIONS §2 W5).** One-way placeholders in v1 (no reversible mapping store). C1 invokes the C4 `GovernanceGate::pre` on prompts + retrieved context + MCP tool inputs before egress, and `post` on model output + tool outputs, at the C1/C4 inference point. Streaming redaction may require buffering or a crate stream-transform hook (GH-6).
- **MCP tool egress.** The per-(role×space) allow-list is enforced at tool-call time: `http/sse` tools SSRF-filtered, `stdio` tools sandboxed (X1 registry).
- **Negative-test gate.** The F1 RW12 adversarial harness plus C1 integration tests must prove: cross-tenant read = 0 rows; a member without `budget.write` cannot raise a cap via `/v1/budgets`; a revoked key/device is rejected; a `hard` cap is never exceeded under concurrency; no secret appears in any response/log.

---

## 6. Key flows

**6.1 — Authenticated chat (`POST /v1/chat`).**
1. Middleware extracts `Authorization: Bearer`. If JWT → verify via JWKS → `tenant_id` + `role_ids`; if `sk_str_…` → validate key → identity.
2. Resolve `RequestContext`: capabilities from `role_permissions`; budget subject node from identity; device status (JWT path); `space_id` from body.
3. **Device check** (JWT): if `device.status != active` → `403`.
4. **C4 `pre`**: redact-in-flight, classification/injection checks, resolve MCP allow-list for `space_id`.
5. **Budget reserve**: estimate cost → `BudgetGuard::reserve(subject_node, est)` → `SELECT … FOR UPDATE` the node path, verify every ancestor has headroom; `hard` with no headroom → `402 budget_exceeded`; `soft` → proceed + flag overshoot.
6. Build `InferenceRequest` (capability `TextChat`, `chain`/`model`, payload) → `Gateway::execute(&req)`.
7. **C4 `post`**: redact/mask output.
8. **Budget commit**: `BudgetGuard::commit(hold, actual_cost)`; roll `spent_amount` up the path.
9. Persist `inference_calls` (+ attribution) + `execution_traces` via `PgGatewayStore`.
10. Return `ChatResponse` (content, model, usage, cost, `inference_call_id`, `trace_id`). On any failure after reserve → `BudgetGuard::release(hold)`.

**6.2 — Streaming chat (`POST /v1/chat/stream`).** As 6.1 through reserve; call `Gateway::execute_stream`; forward each `StreamChunk` as an SSE `Event`; apply C4 streaming redaction (buffer or GH-6 hook); on stream end emit a `done` event with usage/cost, then commit budget + persist. Client disconnect → release/commit with metered-so-far and persist a `status=partial` row.

**6.3 — Embed (`POST /v1/embed`).** Resolve the **embedding chain** (capability `TextEmbedding`), enforce 1024-dim output (to match `document_embeddings vector(1024)`), reserve→execute→commit→persist. Used by C5 ingestion + query.

**6.4 — Compare (`POST /v1/compare`).** `mode=panel` → `Gateway::execute_panel` (N models in parallel → `PanelResponse`); `mode=consensus` → `Gateway::execute_consensus` (→ `ConsensusResult`). Budget reserve covers the **sum** of all slots; commit per-slot actuals; persist one `inference_calls` row per slot with a shared `compare_group_id`.

**6.5 — Privileged write (e.g. `POST /rpc/budgets/upsert-node`).**
1. Auth → `RequestContext`. 2. `require(ctx, Capability::BudgetWrite)` — else `403 forbidden`. 3. Validate body against tenant + domain rules (C3). 4. Write `budget_nodes` as `service_role`, scoped to `ctx.tenant_id`. 5. C4 emits `audit_events` (`actor_id = ctx.identity`). 6. Trigger config reload if the write affects live routing/credentials. 7. Return the updated row.

**6.6 — Config assembly + credential injection (startup + on change).**
1. Connect `sqlx` pool. 2. `load_gateway_config(pool)` → build `RouterConfig`/`ModelConfig`/`FallbackChainConfig` from `config.*` + overrides + `fallback_chains`. 3. Register cloud + (D3) local adapters into the `v0.4.6` `AdapterRegistry`. 4. `Gateway::new(config, adapters, breaker).with_store(PgGatewayStore)`. 5. `refresh_router_keys(resolver)` where the resolver **decrypts `router_credentials` via F3** (`api_key` → static bearer; `oauth` → current access token, GH-2). 6. `/ready` returns 200. On a `/v1/connections`, `/v1/routing/chains`, or `/v1/models` write, re-run 2–5 (or a targeted `update_config`).

**6.7 — Crate migration (FIRST build task — MIG-1/2/3).** Before any of the above: repin root `Cargo.toml` `[patch]` to the real `sensei-*` packages at `../gateway/crates/*` (drop nonexistent `gateway-embedded`; MIG-1); rewrite `main.rs` adapter registration from the deleted `InferenceAdapter` to the `v0.4.6` `AdapterRegistry`/capability-trait model (MIG-2); update `services/gateway/Cargo.toml` (+ desktop `src-tauri/Cargo.toml`) to depend on `sensei-gateway` at the pinned `v0.4.6` git tag (MIG-3). Compile loop runs via the background controller, not a subagent.

---

## 7. Gateway-crate dependencies

Pin `sensei-gateway`/`sensei-kernel`/`sensei-cloud-providers` (+ `sensei-local-*` for the desktop embedded path via D3) at **`v0.4.6`** (git tag; `[patch]` for dev-in-place). Lib import name stays `gateway`.

| Issue | What C1 needs | Blocking? |
|---|---|---|
| **GH-1** | Per-step `plane` + execution-location on `ChainEntry`/`Attempt`/`ExecutionTrace` — so the persisted trace + `inference_calls.execution_location` and the "why this model" trace carry local/cloud. | Before C2/D3 (C1 persists the field once present). |
| **GH-2** | OAuth/bearer provider-credential support in `sensei-cloud-providers` (`resolve_api_key` is static `bearer_auth` today) so `refresh_router_keys` can inject an OAuth access token + a 401-triggered refresh cooperating with the F3 refresher. **Anthropic only in v1.** | Before C1 serves a real OAuth account. |
| **GH-4** | Concurrency-safe **reserve→commit** affordance — verify the crate budget filter is soft/affordability-only; if it cannot do a pre-call reserve, C1/C3 implement reserve→commit **consumer-side** against `inference_calls`/`budget_holds` (the ratified approach). | Decide before C3; C1 owns the call sites. |
| **GH-5** | `inference_calls` ledger shape — confirm the crate owns/writes it and extend `InferenceCall` with org→dept→team→user attribution + rollup shape (crate already exposes `get_usage_since(subject,…)`). | Decide before F1-rework/C3. |
| (GH-6) | Streaming-safe redaction hook — informs whether C1 buffers streamed output for C4 redaction or uses a crate stream-transform point. | Investigate before C4 streaming. |
| (GH-7) | MCP/tool-calling interface — determines whether tool invocation is consumer-side in C1/C4 or crate-exposed. | Investigate before X1. |

Each enhancement is a gateway-repo issue (create → implement → close), released via the lockstep tag bump, sequenced before its dependent Torii phase.

---

## 8. Decisions resolved

- **D1 — JWT verification is RS256/JWKS only; HS256 removed.** The scaffolded HS256 path (Phase 2a "prereq #2") is superseded by DECISIONS §2 W3. *Rationale: a shared secret in config forges tokens; verify-only JWKS cannot.*
- **D2 — Capabilities resolved server-side; JWT carries `tenant_id` + `role_ids` + `claims_version`.** *Rationale: keeps the JWT bounded and lets a role-permission edit take effect without re-minting every token (claims_version drives cache invalidation).*
- **D3 — Privileged writes are per-domain REST `/v1/<domain>/<resource>` endpoints, not one generic mutation blob.** *Rationale: each domain checks a specific capability and emits a typed audit event; a generic blob would blur authz and audit granularity.*
- **D4 — Budget reserve→commit is consumer-side in C1/DB (not inside the crate).** `reserve` takes `SELECT … FOR UPDATE` on the node path, verifies every ancestor, writes a `budget_holds` row; `commit` writes actual cost + rolls up `spent_amount`; `release` on failure. `hard` blocks; `soft` allows bounded overshoot + alert. *Rationale: the crate budget filter is affordability/step-down only (GH-4) and cannot guarantee "no overshoot under concurrency"; a DB row/advisory lock can.*
- **D5 — API keys authenticate an identity; budget binds to the identity's node, never the key.** *Rationale: DECISIONS §2 W2 — multiple keys per identity share one budget; keys are credentials, budgets bind to identity/node.*
- **D6 — Device-status check is on the C1 hot path via a short-TTL cache invalidated by Supabase Realtime.** *Rationale: a per-call DB round-trip is too costly; a stale-tolerant cache with Realtime invalidation bounds the revocation window without a hot-path query on every request.*
- **D7 — The authz write path is inline in C1 (not a separate service) for v1.** *Rationale: both satisfy §2 W1; inline avoids a second deploy unit and a second credential-holding process, and C1 already holds `service_role` + config. Revisit if the write surface needs independent scaling.*
- **D8 — Provider credentials come from the F3 vault (`refresh_router_keys` decrypts `router_credentials`); env keys are local-dev only.** The Phase-2a env-key path is a `#[cfg(dev)]` fallback. *Rationale: DECISIONS §2 W4 — no deployed phase holds plaintext keys.*
- **D9 — OAuth provider accounts are Anthropic-only in v1;** all other providers use BYOK API keys. *Rationale: DECISIONS §3.*
- **D10 — Redaction is one-way placeholders in v1 (no reversible mapping store).** *Rationale: DECISIONS §2 W5.*
- **D11 — Local plane is embedded in-process (D3), reached via the same chain machinery;** `execution_location='local'` rows arrive via the desktop router. C1 itself serves the cloud plane. *Rationale: DECISIONS §3.*

---

## 9. Acceptance criteria (observable, testable)

1. **Crate migration:** `cargo build -p torii-gateway` compiles against `sensei-gateway@v0.4.6` with the capability-trait `AdapterRegistry` (no `InferenceAdapter` reference); root `[patch]` resolves without `gateway-embedded`.
2. **JWT (RS256):** a request with a valid RS256 Supabase JWT is admitted; an HS256 token, an expired token, a wrong-`aud` token, and a token signed by an unknown key each return `401`. No HS256 secret is read from env.
3. **API key → identity:** a valid `sk_str_…` key is admitted and resolves to its identity; a revoked key returns `401`; SELECT on `api_keys` by any client returns hash/prefix only (no usable secret, no budget column).
4. **Tenant isolation:** a caller for tenant A cannot read or write tenant B's ledger/config; cross-tenant read returns 0 rows (RW12 harness green).
5. **Device revocation:** a JWT whose device is `revoked` returns `403 device_revoked` on `/v1/chat` within the cache TTL of revocation.
6. **Chat end-to-end:** `POST /v1/chat` with a seeded chain returns a real cloud answer, injects the provider credential server-side (never in the response/logs), and writes exactly one `inference_calls` row with correct tenant + attribution + cost.
7. **SSE:** `POST /v1/chat/stream` streams `text/event-stream` chunks and ends with a `done` event carrying usage/cost; a completed stream persists one ledger row.
8. **Embed:** `POST /v1/embed` returns 1024-dim vectors via the embedding chain.
9. **Compare:** `POST /v1/compare` returns a panel (N results) or consensus result; each slot persists a ledger row sharing a `compare_group_id`.
10. **Budget hard cap (concurrency):** with a `hard` node at its cap, K concurrent `/v1/chat` calls admit ≤ headroom and reject the rest with `402`; `spent_amount` never exceeds the cap. A `soft` node admits with a recorded overshoot + `alert_events` row.
11. **Privileged-write authz:** each `/v1/<domain>/<resource>` write succeeds for a caller with the required capability and returns `403` for a caller without it; every success emits an `audit_events` row bound to the caller's identity; no privileged write succeeds via direct PostgREST as `authenticated`.
12. **Config reload:** after `/v1/connections` (or `/v1/routing/chains` / `/v1/models`), a subsequent `/v1/chat` uses the new config without a restart.
13. **Health/readiness:** `GET /health` = 200 always; `GET /ready` = 503 until pool + `is_configured()` + JWKS are up, then 200.
14. **Secret hygiene:** no provider key/OAuth token appears in any response body, log line, trace row, or error payload (asserted by a log-scan test).

---

## 10. Open questions

1. **Multi-region / residency pinning.** Region-pin is a routing-policy field in C2; the C1 deployment topology (single region vs. multi-region active-active, and how a `service_role` connection is scoped per region) is undecided.
2. **Streaming redaction mechanics (GH-6).** Whether C1 buffers the full streamed response for C4 redaction (defeats streaming latency) or the crate gains a stream-transform hook — pending the GH-6 investigation.
3. **Config-reload granularity.** Whether a `/v1/routing/chains`, `/v1/connections`, or `/v1/models` write triggers a full `update_config` rebuild or a targeted delta; and how in-flight requests observe the change (accept eventual consistency vs. drain).
4. **Reserve cost estimation accuracy.** How C1 estimates pre-call cost for `reserve` (token-count heuristic vs. model-declared max) and the reconciliation delta at `commit` — impacts how tight a `hard` cap can be enforced without over-reserving.
