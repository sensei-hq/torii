# C2 · Routing, chains & resilience

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Central · **Status:** Planned · **Depends on:** C1 · engine crates `sensei-*` @ `v0.4.6` (`sensei-gateway`/`sensei-kernel`)

## Purpose

How a request selects a model and degrades gracefully — fallback chains, circuit breaking, budget-aware step-down — surfaced as editable config.

## Responsibilities

- Manage chains and routing policy; map DB config onto the engine; expose health.

## What we build

- **Chain CRUD** over F1 (`fallback_chains`, `fallback_chain_models`): create/reorder steps, set trigger rules, per-step model+router. Chain writes are **gateway-mediated** (privileged, `service_role`-write via C1's authz path, §2 W1).
- **Named chains per capability** (chat, generate, cheap, local, demo) and **per-space/role binding** (which chain a space/role uses) — binding respects the permission matrix and feature governance.
- **Per-step plane** metadata (`local | cloud`) so the device router (D3) knows which steps it can run locally. **Crate gap:** `ChainEntry`/`Attempt`/`ExecutionTrace` in `sensei-kernel` carry **no** `plane`/execution-location field today — a gateway-repo issue adds per-step `plane` + execution-location to the config + trace (the D3/C2 unified split-plane trace), sequenced before this phase (§3 crate enhancements).
- Map DB chains → engine `FallbackChainConfig`; configure the **circuit breaker** (threshold/timeout/half-open — `CircuitBreakerConfig` already exists in the crate) and **routing policy** (retry budget, hard timeout, region pin, health interval).
- **Budget-aware step-down**: the engine's budget filter steps down under pressure; hard/soft node semantics and the hard reserve are owned by C1/C3 (§2 W2).
- Provider **health** surface.

## Key contracts / data

- `FallbackChainConfig`, `ChainEntry`, `FallbackTrigger`, `CircuitBreakerConfig` (from `sensei-kernel`/`sensei-gateway`). `ChainEntry` + the trace need a `plane`/execution-location field — see the crate enhancement above.

## UI surfaces

- Routing (W1): chain editor, fallback simulator, routing policy, provider health. The current Routing screen is **read-only** — §6 makes it an editable chain editor.

## Reuse / source

`sensei-gateway` crate `selection.rs`, `circuit_breaker.rs`, `config.rs`; `strategos_old` chain services.

## Open questions

- **Resolved:** chains carry a per-step `plane` (`local | cloud`) and per-space/role binding. Residual: how the fallback simulator visualizes local vs cloud steps + execution-location badges (§6) — blocked on the crate trace enhancement (above).
