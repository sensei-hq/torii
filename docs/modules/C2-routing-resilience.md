# C2 · Routing, chains & resilience

**Plane:** Central · **Status:** Planned · **Depends on:** C1

## Purpose

How a request selects a model and degrades gracefully — fallback chains, circuit breaking, budget-aware step-down — surfaced as editable config.

## Responsibilities

- Manage chains and routing policy; map DB config onto the engine; expose health.

## What we build

- **Chain CRUD** over F1 (`fallback_chains`, `fallback_chain_models`): create/reorder steps, set trigger rules, per-step model+router.
- **Named chains per capability** (chat, generate, cheap, local, demo) and **per-space/role binding** (which chain a space/role uses).
- **Per-step plane** metadata (local vs cloud) so the device router (D3) knows which steps it can run locally.
- Map DB chains → engine `FallbackChainConfig`; configure circuit breaker (threshold/timeout/half-open) and **routing policy** (retry budget, hard timeout, region pin, health interval).
- Provider **health** surface.

## Key contracts / data

- `FallbackChainConfig`, `ChainEntry`, `FallbackTrigger`, `CircuitBreakerConfig` (gateway crate).

## UI surfaces

- Routing (W1): chain editor, fallback simulator, routing policy, provider health.

## Reuse / source

`gateway` crate `selection.rs`, `circuit_breaker.rs`, `config.rs`; `strategos_old` chain services.

## Open questions

- How chains span planes (per-step plane flag) and how the simulator visualizes local steps.
