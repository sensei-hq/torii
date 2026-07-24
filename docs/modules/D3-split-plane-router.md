# D3 · Split-plane router

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Device · **Status:** Planned · **Depends on:** C1, D2, D4

## Purpose

The brain of the desktop app: decide, per request and per fallback step, whether to run locally or proxy to the central gateway — and present it as one unified result.

## What we build

- **Routing decision**: local-capable request/step → run via the embedded local engine (D2); any step needing a provider credential → **proxy to the central gateway (C1) via a capability-trait adapter** (`ChatModel`/`EmbedModel`) with the device token + Supabase JWT. Provider credentials stay central (F3 vault) and never touch the device; C1 runs a **per-request device-status check** so a revoked device with a live JWT cannot keep spending (DECISIONS §2).
- **Chain spanning planes**: walk a chain whose steps carry a plane flag (C2) — e.g. `[opus(cloud) → sonnet(cloud) → gemma(local)]`. **Crate gap:** `ChainEntry`/`Attempt`/`ExecutionTrace` (`kernel::types`) carry no per-step `plane`/execution-location today — this needs a **gateway-repo crate enhancement** (DECISIONS §3/§7, filed below), sequenced before this phase.
- **Unified trace**: merge local + proxied attempts into one response/trace with execution-location per step (depends on the same trace enhancement).
- **Local usage telemetry** reported to central (D4) into the single authoritative **`inference_calls`** ledger so budgets stay unified (local calls = $0 but logged); no separate `gateway_tasks` cost path.

## Key contracts / data

- Request envelope (capability, chain, payload); per-step plane flag (pending the crate enhancement); unified `Attempt[]` trace (`ExecutionTrace`).

## UI surfaces

- Feeds per-step execution-location badges in W2/W3.

## Reuse / source

`sensei-gateway` selection/fallback model (`ExecutionTrace`/`Attempt`); C1 client; gap analysis §1 (execution-location awareness).

## Open questions

- Locality decision inputs (config flag + on-device capability).
- Offline behavior for cloud steps: queue-and-retry (via the D4 buffer) vs fail-with-local-fallback.
