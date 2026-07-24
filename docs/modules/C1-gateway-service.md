# C1 · Gateway service & API

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Central · **Status:** Planned · **Depends on:** F1, F2, F3 · engine crates `sensei-*` @ `v0.4.6` (wraps `sensei-gateway`)

## Purpose

The central HTTP **authority** for all cloud (BYOK) inference. Wraps the `sensei-gateway` crate, enforces auth/tenancy, and is the only place provider credentials are decrypted and used. It is also the **gateway-mediated write path** (§2 W1): the sole writer for privileged tables, enforcing the permission matrix server-side.

## Responsibilities

- Terminate client requests, authorize them, assemble routing config from the DB, call the engine, stream results, and persist call records.

## What we build

- **Axum service** (`services/gateway`) consuming the pinned engine crates — `sensei-gateway = { git=".../gateway", tag="v0.4.6" }` (+ `sensei-kernel`, `sensei-cloud-providers`; `[patch]` for dev).
- **JWT auth middleware (RS256/JWKS)**: verify Supabase JWTs with a **verify-only asymmetric public key from the JWKS endpoint** — not a shared HS256 secret (§2 W3) — then resolve `tenant_id` + the caller's **role/permissions** for server-side authz. Per-request **device-status check** on the proxy hot path so a revoked device with a live JWT cannot keep spending (§2 apply-without-asking).
- **API-key auth**: `api_keys` (owned by the **Organization** screen, decision #2) authenticate an **identity** — a person or a `service_account` — via hashed secret + public prefix, capability scope, and rate limit. The resolved **identity, not the key**, determines budget and permission scope; multiple keys for one identity share that identity's budget node (§2 W2). Reveal-once issuance, rotate/revoke.
- **Gateway-mediated privileged writes / authz API** (§2 W1): C1 (or a thin authz API in front of it) is the **only** writer for privileged tables (roles, budgets, routing chains, governance/classification, `space_members`, catalog overrides), enforcing the permission matrix server-side. No direct PostgREST writes to privileged tables.
- **Config assembly**: build the engine's `GatewayConfig` from DB routers/models/chains; inject decrypted provider credentials from the **F3 vault** via `refresh_router_keys()` at call time — now `router_credentials` (`type = api_key | oauth`, with auto-refreshed OAuth access/refresh tokens). F3 **must** land before C1 handles any real key; production KEK lives in a cloud **KMS/HSM** (§2 W4).
- **Budget hard reserve**: pre-call **reserve → commit** against the `service_role`-only ledger; `hard` nodes cannot be exceeded under concurrency (C3 owns the org→dept→team→user cascade, §2 W2).
- **Redaction in-flight (§2 W5)**: at the C1/C4 inference point, scan + redact secrets/PII in prompts, retrieved context, agent messages, and MCP tool I/O before egress to any model (implemented in the C4 consumer-side wrapper around `execute`/`execute_stream`).
- **MCP enforcement**: enforce the per-(role×space) tool allow-list **at tool-call time** — SSRF-filter `http/sse` tools, sandbox `stdio` tools (X1 owns the registry).
- **Endpoints**: `/v1/chat`, `/v1/embed`, `/v1/generate`, `/v1/compare`, with **SSE streaming**.
- **Persistence**: implement the engine's `GatewayStore` trait against Postgres → the one authoritative **`inference_calls`** ledger (inference calls, execution traces, spend; retire `gateway_tasks` cost duplication) → feeds C3/O1/O2.
- Deploy as a container (Cloud Run / Fly.io / Fargate) behind Cloudflare at `api.`.

## Key contracts / data

- `InferenceRequest`/`InferenceResponse`, `Capability`, `GatewayStore` (from `sensei-gateway`/`sensei-kernel`). Models expose the **capability traits** `ChatModel`/`EmbedModel`/… — the old `InferenceAdapter` is deleted.

## UI surfaces

None — consumed by W1/W2/W3 and the desktop split-plane router (D3).

## Reuse / source

`sensei-gateway` crate (`engine.rs`, `store.rs`); Sensei daemon HTTP patterns.

## Open questions

- Multi-region deployment / residency pinning (region-pin is a routing-policy field in C2; deployment topology TBD).
- Whether the authz write path is inline in C1 or a separate thin service (both satisfy §2 W1).
