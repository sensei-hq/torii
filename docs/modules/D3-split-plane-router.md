# D3 · Split-plane router

**Plane:** Device · **Status:** Planned · **Depends on:** C1, D2, D4

## Purpose
The brain of the desktop app: decide, per request and per fallback step, whether to run locally or proxy to the central gateway — and present it as one unified result.

## What we build
- **Routing decision**: local-capable request/step → run via `gateway-embedded` (D2); any step needing a provider key → **proxy to the central gateway (C1)** with the device token + Supabase JWT. Keys never touch the device.
- **Chain spanning planes**: walk a chain whose steps carry a plane flag (C2) — e.g. `[opus(cloud) → sonnet(cloud) → gemma(local)]`.
- **Unified trace**: merge local + proxied attempts into one response/trace with execution-location per step.
- **Local usage telemetry** reported to central (D4) so the ledger/budgets stay unified (local calls = $0 but logged).

## Key contracts / data
- Request envelope (capability, chain, payload); per-step plane flag; unified `Attempt[]` trace.

## UI surfaces
- Feeds execution-location badges in W2/W3.

## Reuse / source
`gateway` selection model; C1 client; gap analysis §1 (execution-location awareness).

## Open questions
- Locality decision inputs (config flag + on-device capability).
- Offline behavior for cloud steps: queue-and-retry vs fail-with-local-fallback.
