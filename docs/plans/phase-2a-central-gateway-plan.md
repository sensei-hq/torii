---
title: 'Phase 2a · Central gateway service (C1) — implementation plan'
description: A Rust/Axum service (services/gateway) wrapping the sensei-gateway crate (v0.4.6) — Supabase RS256/JWKS JWT auth, GatewayConfig assembled from the F1 Postgres tables, one sanctioned provider key from env for the skeleton (F3 vault is the build gate before real BYOK/OAuth credentials), a Postgres GatewayStore, and /v1/chat + SSE — so a JWT-bearing client gets a real cloud answer that's persisted.
type: plan
status: plan
created: 2026-07-07
depends_on:
  - docs/DECISIONS.md
  - docs/plans/roadmap.md
  - docs/plans/phase-1b-local-inference-ask-plan.md
references:
  - docs/plans/gateway-issues.md
  - docs/plans/F1-rework-plan.md
  - docs/modules/C1-gateway-service.md
  - docs/modules/F2-identity-auth-rbac.md
  - docs/modules/F3-key-vault.md
  - docs/modules/O1-ledger-audit.md
milestone: Phase-2a
---

# Phase 2a · Central gateway service (C1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **Heavy Rust builds run via a BACKGROUND shell (controller), not inside a subagent** (the `gateway` + AWS SDK + sqlx compile is minutes; the watchdog will kill a subagent). Subagents WRITE code; the controller compiles + runs. DB changes go through **dbd** (`dbd reset && dbd apply && dbd import`) per the project workflow.

**Goal:** A client that presents a valid Supabase JWT can `POST /v1/chat` to the central service and get a **real cloud answer** — routed by the `sensei-gateway` engine using config assembled from the F1 Postgres tables, with the provider key injected server-side (never sent to the client), the call persisted to a Postgres ledger, and streaming available over SSE.

**Canonical phase:** This is **P2a** in [`roadmap.md`](roadmap.md) (walking skeleton, Part A) — a thin vertical slice on the **built-but-insecure F1**. The ratified security posture (gateway-mediated `/rpc/*` writes, capability authz, full BYOK/OAuth via F3) is the P5 **C1-harden** rebuild on the reworked schema (P3 F1-rework); do **not** build hardened authz here. Status per roadmap §3: **reconcile** (crate-reality MIG-1..3 + RS256).

**Architecture:** A new `services/gateway` Rust crate (Axum 0.8) in the existing Cargo workspace, wrapping the `sensei-gateway` crate at **v0.4.6** (dependency key `sensei-gateway`; its `[lib] name = "gateway"`, so code still imports `gateway::…`). The root `[patch]` redirects the `sensei-*` packages to `../gateway/crates/*` (see MIG-1 in Task 1). Startup: connect a `sqlx` Postgres pool → `load_gateway_config(pool)` builds `GatewayConfig` from `routers`/`models`/`model_endpoints`/`fallback_chains`/`fallback_chain_models` → build an `AdapterRegistry` (register each `sensei-cloud-providers` adapter via `registry.register(Arc::new(adapter)).await` — the `RegisterInto`/capability-trait model; there is **no** `InferenceAdapter` and **no** `AdapterRegistry::with_defaults()` in v0.4.6) → `Gateway::new(config, registry, circuit_breaker)` → `refresh_router_keys(env_resolver)` injects provider keys **from env** (via each router's `api_key_env_var`). A tower middleware verifies the Supabase JWT with an **RS256 verify-only public key fetched from the project JWKS endpoint** (asymmetric — no shared HS256 secret; DECISIONS §2 W3) and extracts `tenant_id`/`role`. Handlers build an `InferenceRequest`, call `gateway.execute()`/`stream()`, persist via a Postgres `GatewayStore` impl, and return JSON / SSE.

**Tech Stack:** Rust · Axum 0.8 · `sqlx` 0.8 (postgres, chrono, uuid, json) · `tokio` · `tower-http` (cors) · `jsonwebtoken` (RS256) + `reqwest` (JWKS fetch/cache) · `sensei-gateway` crate @ v0.4.6 (git dep + root `[patch]`; cloud adapters via the `sensei-gateway` cloud feature or `sensei-cloud-providers` directly) · Supabase Postgres.

**Reference (adapt the patterns):** sensei `/Users/Jerry/Developer/sensei-hq/sensei/crates/senseid/` — `api/server.rs` (bootstrap), `api/routes.rs`, `api/gateway_config_loader.rs` (config assembly — pure builders + async queries), `api/handlers/scan_events.rs` (SSE), `db/pg_store.rs` (pool). The gateway crate at `/Users/Jerry/Developer/strategos/gateway/crates/gateway/src/`: `store.rs` (the real `GatewayStore` trait + `InferenceCall`/`StoredTrace` — implement THIS), `config.rs` (incl. `GatewayBuilder`), `engine.rs` (`Gateway::new`, `refresh_router_keys`), `lib.rs`. Adapter registration + capability traits live in `sensei-kernel` (`kernel::adapters::{AdapterRegistry, RegisterInto}`) and `sensei-cloud-providers`.

## Prerequisites & decisions (confirm before executing)

**Prior phases:** P1b complete (roadmap Part A). **Crate migration:** MIG-1..3 from [`gateway-issues.md`](gateway-issues.md) are executed inside this phase (Task 1) with a live compile loop — do NOT blind-edit. **F1-rework (P3) note:** this skeleton runs on the built F1 and adds its own `inference_calls`/`execution_traces` tables (prereq 3); P3 RW7 later **consolidates on the crate-native `inference_calls` as the single `service_role`-only ledger** (DECISIONS §3) and reworks RLS to the role matrix — so keep this phase's tables shaped to the engine's `InferenceCall`/`StoredTrace` to minimize churn, and expect the RLS/grants to be re-hardened in P3/P5.

1. **Skeleton = one sanctioned provider key from env; F3 is the build gate for real credentials.** For the walking skeleton C1 resolves keys via `routers.api_key_env_var` → `std::env::var` using **one sanctioned test key** + local-dev `STRATEGOS_KEK` (front-loaded human inputs, roadmap §4). Per DECISIONS §2 W4, the DEK/KEK envelope vault (**F3**, phase P4) **must land before C1 handles any real BYOK/OAuth credential broadly** — no deployed phase holds plaintext provider keys, and production KEK lives in a cloud KMS/HSM. Env-key resolution here is explicitly the local-dev-only path (a `// TODO(F3)` marker), replaced by the F3 vault in the C1-harden phase (P5). → Server-side keys, never sent to clients.
2. **JWT verification is RS256/JWKS (verify-only) — no shared HS256 secret.** Per DECISIONS §2 W3, C1 verifies the Supabase JWT with an **asymmetric verify-only public key fetched + cached from the project JWKS endpoint** (`Algorithm::RS256`), selecting the key by the token header `kid`. This requires **asymmetric signing confirmed/enabled on the Supabase project** and the JWKS URL / `SUPABASE_JWT_*` in C1's env (front-loaded, roadmap §4) — confirm before Task 6.
3. **New ledger tables via dbd.** The `GatewayStore` needs `inference_calls` + `execution_traces` tables (the F1 `session_logs`/`gateway_tasks` don't match the engine's `InferenceCall` shape). Added to `database/ddl` + applied via dbd (an F1' extension) with RLS. (P3 RW7 consolidates/re-hardens — see the F1-rework note above.)
4. **The acceptance test makes a REAL paid cloud call** (one small Anthropic/OpenAI chat) to prove end-to-end — **requires the front-loaded paid-provider-call approval** (roadmap §4). Kept to a single cheap call.
5. **Deploy = local dev** (`cargo run`, `127.0.0.1:8787`) for this phase; Cloudflare/container is later.

---

## File structure

```
monorepo/
  Cargo.toml                       # add "services/gateway" to workspace members
  services/gateway/
    Cargo.toml
    .env.example                   # DATABASE_URL, SUPABASE_JWKS_URL, PORT, STRATEGOS_KEK (local-dev), <PROVIDER>_API_KEY
    src/
      main.rs                      # bootstrap: env, pool, config, gateway, serve
      state.rs                     # AppState { pool, gateway: Arc<Gateway> }
      config_loader.rs             # load_gateway_config(pool) -> GatewayConfig (+ pure builders + tests)
      keys.rs                      # env_resolver: router_id -> Option<String> via api_key_env_var
      auth.rs                      # Supabase JWT middleware -> Claims { tenant_id, role, sub }
      store.rs                     # impl gateway::GatewayStore for PgGatewayStore
      routes/
        mod.rs
        chat.rs                    # POST /v1/chat  + GET/POST /v1/chat/stream (SSE)
        health.rs                  # GET /health, GET /v1/status
  database/ddl/table/public/
    inference_calls.ddl            # new ledger table (+ RLS)
    execution_traces.ddl           # new trace table (+ RLS)
```

---

## Task 1: scaffold `services/gateway` crate + bootstrap

**Files:** modify root `Cargo.toml` (add member); create `services/gateway/Cargo.toml`, `.env.example`, `src/main.rs`, `src/state.rs`, `src/routes/health.rs`, `src/routes/mod.rs`.

- [ ] **Step 1 (MIG-1):** add `"services/gateway"` to the root `Cargo.toml` `[workspace] members`. **Fix the root `[patch]`** — it currently keys `gateway`/`gateway-embedded` (neither package exists; patch keys must be the real *package* names). Repin to the actual `sensei-*` packages at `../gateway/crates/*`:
  ```toml
  [patch."https://github.com/sensei-hq/gateway"]
  sensei-gateway         = { path = "../gateway/crates/gateway" }
  sensei-kernel          = { path = "../gateway/crates/kernel" }
  sensei-cloud-providers = { path = "../gateway/crates/cloud-providers" }
  # sensei-local-engine / sensei-local-providers are the P1b/D2 local path — patch only if depended on
  ```
  Confirm `cargo metadata`/`cargo check` resolves the patch (roadmap P0 gate).
- [ ] **Step 2 (MIG-3):** `services/gateway/Cargo.toml` — deps: `axum = { version = "0.8", features = ["json"] }`, `tokio = { version = "1", features = ["full"] }`, `tokio-stream = { version = "0.1", features = ["sync"] }`, `tower-http = { version = "0.6", features = ["cors", "trace"] }`, `sqlx = { version = "0.8", features = ["runtime-tokio", "postgres", "chrono", "uuid", "json"] }`, `jsonwebtoken = "9"`, `reqwest = { version = "0.12", features = ["json"] }` (JWKS fetch), `serde`/`serde_json`, `chrono`, `uuid`, `anyhow`/`thiserror`, `tracing`/`tracing-subscriber`, `dotenvy`, and `sensei-gateway = { git = "https://github.com/sensei-hq/gateway", tag = "v0.4.6" }` (root `[patch]` redirects to `../gateway/crates/gateway`; imported as `gateway::` via its `[lib] name = "gateway"`). Enable `sensei-gateway`'s cloud-providers feature (or add `sensei-cloud-providers` directly, imported as `cloud_providers`). Drop any `gateway-embedded` dep — **it does not exist**.
- [ ] **Step 3:** `src/state.rs` — `pub struct AppState { pub pool: sqlx::PgPool, pub gateway: std::sync::Arc<gateway::Gateway> }` (+ `type SharedState = Arc<AppState>` if preferred).
- [ ] **Step 4 (MIG-2 · adapter registration):** `src/main.rs` — load `.env` (dotenvy), init tracing, read `DATABASE_URL`/`PORT`/`SUPABASE_JWKS_URL` (+ `STRATEGOS_KEK` local-dev), connect the pool (`PgPoolOptions::new().max_connections(10).connect(&url)`). Build the `AdapterRegistry` the **v0.4.6** way: `let reg = kernel::adapters::AdapterRegistry::new();` then `reg.register(std::sync::Arc::new(cloud_providers::AnthropicAdapter::new(...))).await;` per cloud adapter (each impls `kernel::adapters::RegisterInto`; capability traits `ChatModel`/`EmbedModel`/… are on the target *model*, per DECISIONS §3). **There is no `InferenceAdapter` and no `AdapterRegistry::with_defaults()`** — verify the exact adapter constructors against `sensei-cloud-providers/src/lib.rs` at file time. Build the gateway (Task 4 wires config; for Step 4 use an empty/`is_configured()==false` config so it boots) via `gateway::Gateway::new(config, reg, circuit_breaker)`, assemble the Router (Task 7 adds routes; for now just `/health`), CORS (explicit methods), `.with_state`, `axum::serve` on `127.0.0.1:PORT` (default 8787).
- [ ] **Step 5:** `src/routes/health.rs` — `GET /health` → `Json(json!({ "status": "ok" }))`.
- [ ] **Step 6 (CONTROLLER, background):** `cargo build -p <services/gateway crate name>` — compiles (first build pulls axum/sqlx/aws-sdk + the six `sensei-*` crates — minutes). Then `cargo run` + `curl 127.0.0.1:8787/health` → `{"status":"ok"}`. Report.
- [ ] **Step 7:** commit — `feat(c1): scaffold central gateway service (axum + pool + health)`.

---

## Task 2: DB — inference ledger tables (dbd)

**Files:** create `database/ddl/table/public/inference_calls.ddl`, `execution_traces.ddl`; RLS in `database/policies/`.

- [ ] **Step 1:** `inference_calls.ddl` — columns matching the engine's `InferenceCall` (from `gateway/crates/gateway/src/store.rs` — READ it for exact fields): `tenant_id uuid`, `id uuid`, `session_id uuid null`, `project_id uuid null`, `capability text`, `chain_id text null`, `adapter text`, `model text`, `api_model_id text null`, `input_tokens int null`, `output_tokens int null`, `cost_usd numeric(12,6)`, `duration_ms int`, `status text`, `error_type text null`, `fallback_sequence int`, `recorded_at timestamptz default now()`. PK `(tenant_id, id)`. Index on `(tenant_id, recorded_at)` + `(tenant_id, model)`.
- [ ] **Step 2:** `execution_traces.ddl` — matching `StoredTrace`: `tenant_id`, `id`, `inference_call_id`, step/adapter/model/status/error, `recorded_at`. FK → `inference_calls(tenant_id, id)`.
- [ ] **Step 3:** RLS — tenant-isolation policies keyed on the JWT `tenant_id` claim (mirror the existing F1 RLS pattern; read `database/policies/` for the house pattern). Add to the dbd policy set.
- [ ] **Step 4 (CONTROLLER):** `dbd reset && dbd apply && dbd import` (per project DB workflow) — green. (Or `dbd apply` if additive is safe.) Extend `tests/rls.sql` to cover the two new tables.
- [ ] **Step 5:** commit — `feat(db): inference ledger tables (inference_calls, execution_traces) + RLS`.

---

## Task 3: `GatewayStore` impl (Postgres)

**Files:** create `services/gateway/src/store.rs`.

- [ ] **Step 1:** READ `gateway/crates/gateway/src/store.rs` for the exact `GatewayStore` trait signature + `InferenceCall`/`StoredTrace` structs.
- [ ] **Step 2:** `PgGatewayStore { pool: PgPool, tenant_id: Uuid }` (tenant scoping per request), `impl gateway::GatewayStore for PgGatewayStore` — each method as a `sqlx::query!`/`query_as` against `inference_calls`/`execution_traces`:
  - `insert_inference_call(&self, call) -> Result<Uuid>` → INSERT, return id.
  - `insert_execution_trace`, `get_traces_by_call`, `get_execution_trace`, `get_inference_calls_by_session`.
  - `get_spend_since(&self, since) -> Result<f64>` → `SELECT coalesce(sum(cost_usd),0) FROM inference_calls WHERE tenant_id=$1 AND recorded_at >= $2`.
  - `get_spend_by_model_since` → GROUP BY model.
- [ ] **Step 3:** a `#[cfg(test)]` unit test against a test DB is optional; at minimum it compiles. (Controller builds.)
- [ ] **Step 4:** commit — `feat(c1): Postgres GatewayStore (inference_calls/execution_traces)`.

---

## Task 4: config assembly from Postgres

**Files:** create `services/gateway/src/config_loader.rs`.

- [ ] **Step 1:** adapt sensei's `gateway_config_loader.rs` to the F1 schema. `pub async fn load_gateway_config(pool) -> Result<GatewayConfig>`:
  - **routers:** `SELECT name, api_base_url, api_key_env_var, is_active, default_headers::text FROM config.routers WHERE is_active` → `HashMap<String, RouterConfig>` (`url`, `api_key_env`, `enabled`, `headers`; `api_key: None` — filled by Task 5).
  - **models + endpoints:** join `config.models` × `config.model_endpoints` × `config.routers` → `ModelConfig` (`id` = model full_name/name, `provider` = router name, `capabilities`, `context_window`, `max_output_tokens`, pricing from endpoint costs, `api_model_id` = `model_endpoints.router_model_id`).
  - **chains:** `public.fallback_chains` + `public.fallback_chain_models` (join routers+models) → `FallbackChainConfig` (ordered by `sequence_order`/priority, `fallback_triggers` default).
- [ ] **Step 2:** keep the row→config mapping in **pure builder fns** (`build_routers`, `build_models`, `build_chains`) with unit tests over sample rows (no DB). (Controller runs `cargo test -p …`.)
- [ ] **Step 3:** wire into `main.rs`: `let config = load_gateway_config(&pool).await?;` before `Gateway::new`.
- [ ] **Step 4 (CONTROLLER, background):** build; `cargo run` and hit `GET /v1/status` (added in Task 7 or a temp log) to confirm `is_configured() == true` + adapters/models present (needs the F1 seed data — `dbd import` must have loaded routers/models). Report the assembled router/model/chain counts.
- [ ] **Step 5:** commit — `feat(c1): assemble GatewayConfig from Postgres (routers/models/chains)`.

---

## Task 5: provider-key injection (env)

**Files:** create `services/gateway/src/keys.rs`.

- [ ] **Step 1:** `pub fn env_resolver(pool_routers: &HashMap<String, String>) -> impl Fn(&str) -> Option<String>` — given a map of `router_name → api_key_env_var` (from the loaded config's `RouterConfig.api_key_env`), return a closure `router_id -> std::env::var(env_var).ok()`. (Or resolve directly from `RouterConfig.api_key_env`.)
- [ ] **Step 2:** in `main.rs` after `Gateway::new`: `gateway.refresh_router_keys(resolver).await;` so cloud adapters have their keys. Log how many routers got a key (do NOT log the keys).
- [ ] **Step 3:** `.env.example` documents `ANTHROPIC_API_KEY` etc. (values live in the real `.env`, git-ignored). Note: **F3 vault decryption is the production replacement** (a `// TODO(F3)` marker).
- [ ] **Step 4:** commit — `feat(c1): inject provider keys from env (F3 vault deferred)`.

---

## Task 6: Supabase JWT auth middleware

**Files:** create `services/gateway/src/auth.rs`.

- [ ] **Step 1:** `pub struct Claims { pub sub: String, pub tenant_id: Option<Uuid>, pub role: Option<String>, pub exp: usize, .. }` (matches the `custom_access_token_hook` claims: `tenant_id`, `role`).
- [ ] **Step 2:** a tower/axum middleware (`async fn require_auth(headers, request, next)` or a `FromRequestParts` extractor) that reads `Authorization: Bearer <jwt>`, decodes the token header for its `kid`, fetches + caches the project JWKS (via `reqwest` from `SUPABASE_JWKS_URL`, keyed by `kid`; refetch on cache-miss), builds an **RS256** `DecodingKey` from the matching JWK, and validates with `jsonwebtoken::decode::<Claims>(token, &decoding_key, &Validation::new(Algorithm::RS256))` (set the expected `aud` = `authenticated`); on success attaches `Claims` to request extensions; 401 otherwise. **RS256/JWKS is the only path — there is no shared HS256 secret (DECISIONS §2 W3).**
- [ ] **Step 3:** apply the middleware to the `/v1/*` routes (not `/health`).
- [ ] **Step 4:** a unit test that mints an **RS256** token signed with a test RSA private key (its public JWK served via a stub JWKS the middleware fetches) validates + extracts `tenant_id`, and a bad token 401s. (Controller builds/tests.)
- [ ] **Step 5:** commit — `feat(c1): Supabase JWT auth middleware (tenant/role claims)`.

---

## Task 7: `/v1/chat` + SSE

**Files:** create `services/gateway/src/routes/chat.rs`; wire into `routes/mod.rs` + `main.rs`.

- [ ] **Step 1:** request/response types: `ChatRequest { messages: Vec<{role, content}>, model?: String, chain?: String, system?: String, max_tokens?: u32 }`; `ChatResponse { content, model, usage?, cost_usd, attempts? }`.
- [ ] **Step 2:** `POST /v1/chat` handler (auth'd — `Claims` from extensions): build `InferenceRequest { capability: TextChat, model, chain, payload: Payload::Chat{...}, budget: None }`; `state.gateway.execute(&req).await`; on success, persist via `PgGatewayStore { pool, tenant_id: claims.tenant_id }`.`insert_inference_call(...)` (map the response → `InferenceCall`); return `ChatResponse`. Map errors → proper HTTP status.
- [ ] **Step 3:** `POST /v1/chat/stream` (SSE) — copy sensei's `scan_events.rs` SSE pattern: spawn a task that calls `state.gateway.stream(&req).await` and forwards each `StreamChunk` as an `Event::default().data(json)`; return `Sse::new(stream)`. Persist the final call after the stream ends. (If the engine's `stream()` isn't wired for all adapters, `/v1/chat` non-streaming is the must-have; SSE is best-effort this phase.)
- [ ] **Step 4:** `GET /v1/status` — `{ configured, adapters, models }` (auth'd).
- [ ] **Step 5 (CONTROLLER, background):** build + `cargo run`. Report.
- [ ] **Step 6:** commit — `feat(c1): /v1/chat + /v1/chat/stream (SSE) + /v1/status`.

---

## Task 8: end-to-end acceptance (a real cloud call)

- [ ] **Step 1 (CONTROLLER):** with `.env` (DATABASE_URL, SUPABASE_JWKS_URL, provider keys) present and `dbd import` having seeded routers/models, run C1 (`cargo run -p …`, background). Mint a test JWT **RS256-signed with a test RSA key whose public JWK the running C1 can fetch** (point `SUPABASE_JWKS_URL` at a local stub JWKS for the test) carrying a real `tenant_id` (from the seeded tenants) + `role`, and `curl -sS -X POST 127.0.0.1:8787/v1/chat -H "Authorization: Bearer <jwt>" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"Reply with the single word: hello"}],"chain":"..."}'`. Expect a **real cloud answer** (one small paid Anthropic/OpenAI call) and a new row in `inference_calls` (verify via `psql`/dbd). Record the answer + the persisted row.
- [ ] **Step 2:** an integration test script under `services/gateway/tests/` (or documented in the README) capturing the curl + expected shape. Keep the live-call test `#[ignore]`/opt-in (it costs money + needs secrets).
- [ ] **Step 3:** confirm the provider key never appears in the response/logs.

---

## Task 9: acceptance + cleanup + push

- [ ] **Step 1:** `make clean`-safe: the new crate builds; `bun run test`/`check`/`lint` still green (no JS changed, but confirm); `cargo build` (workspace) compiles `app` + `strategos-gateway`.
- [ ] **Step 2:** `services/gateway/README.md` — run instructions (env vars, `cargo run`, the curl), the env-keys/F3-deferred note, the JWT-secret requirement.
- [ ] **Step 3:** update `apps/README.md` / top-level docs: C1 exists; the desktop split-plane router (Phase 2b) will proxy cloud steps here.
- [ ] **Step 4:** `make clean`, commit (`chore(phase2a): acceptance — C1 serves a real cloud answer`), **push `develop`**.

---

## Self-review notes (author)
- **Spec coverage** (C1 module + blueprint §8 Phase 2, service half): Axum service (Task 1), ledger tables (Task 2), GatewayStore (Task 3), config-from-Postgres (Task 4), key injection (Task 5), JWT auth (Task 6), `/v1/chat`+SSE (Task 7), real-cloud E2E (Task 8). **The desktop split-plane router + config sync (D3/D4) are Phase 2b.**
- **Deferred (flagged):** F3 vault AES-GCM decryption (env keys used); budgets/guardrails enforcement (C3/C4 — the store enables spend queries but enforcement is later); multi-region; container deploy; `/v1/{embed,generate,compare}` (chat first).
- **Biggest risks:** (a) the F1 seed actually populating routers/models so config assembly is non-empty (`dbd import`); (b) `gateway::GatewayStore` exact signature (read `store.rs`); (c) whether the engine's `stream()` works for the cloud adapters (SSE best-effort).
- **Type consistency:** `Claims.tenant_id` (Task 6) flows into `PgGatewayStore { tenant_id }` (Task 3) + the chat handler (Task 7). `RouterConfig.api_key_env` (Task 4) feeds the env resolver (Task 5).
