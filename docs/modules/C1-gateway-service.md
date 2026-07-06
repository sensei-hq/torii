# C1 · Gateway service & API

**Plane:** Central · **Status:** Planned · **Depends on:** F1, F2, F3 · external crate `gateway`

## Purpose

The central HTTP **authority** for all cloud (BYOK) inference. Wraps the `gateway` crate, enforces auth/tenancy, and is the only place provider keys are decrypted and used.

## Responsibilities

- Terminate client requests, authorize them, assemble routing config from the DB, call the engine, stream results, and persist call records.

## What we build

- **Axum service** (`services/gateway`) consuming `gateway = { git=".../gateway", tag="v0.2.18" }` (+ `[patch]` for dev).
- **Auth middleware**: validate Supabase JWT → `tenant_id`/`role` scoping.
- **Config assembly**: build the engine's `GatewayConfig` from DB routers/models/chains; inject decrypted keys via `refresh_router_keys()` (F3) at call time.
- **Endpoints**: `/v1/chat`, `/v1/embed`, `/v1/generate`, `/v1/compare`, with **SSE streaming**.
- **Persistence**: implement the engine's `GatewayStore` trait against Postgres (inference calls, execution traces, spend) → feeds C3/O1/O2.
- Deploy as a container (Cloud Run / Fly.io / Fargate) behind Cloudflare at `api.`.

## Key contracts / data

- `InferenceRequest`/`InferenceResponse`, `Capability`, `GatewayStore` (from the `gateway` crate).

## UI surfaces

None — consumed by W1/W2/W3 and the desktop split-plane router (D3).

## Reuse / source

`gateway` crate (`engine.rs`, `store.rs`); Sensei daemon HTTP patterns.

## Open questions

- **Programmatic API access** for the org's own apps (decision #2) — scoped tenant API keys, rate limiting.
- Multi-region deployment / residency pinning.
