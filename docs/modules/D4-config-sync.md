# D4 · Config sync & offline

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Device · **Status:** Planned · **Depends on:** C1 / Supabase Realtime, F2

## Purpose

Keep the device's view of org config fresh, work offline, and report usage back — the "subscribe to server, changes pushed" mechanism.

## What we build

- **Supabase Realtime subscription** — channels are **RLS-scoped** (per tenant, DECISIONS §2) and authed with the device token; admin edits config → client is notified.
- **Versioned pull**: a `config_version`; on notify or reconnect, pull the latest config (routers/models/chains/policies/budgets + `feature_states` for the 4-state governance layer) and **hot-reload** the local engine via `sensei-gateway` `Gateway::update_config` (or validated `try_update_config`). Provider **credentials are not synced** — central custody in the **F3 `router_credentials` vault** (`api_key` | `oauth`); cloud calls proxy through C1.
- **Offline cache** in the local store (D1) so the app works without network (local models + last-known config).
- **Usage/audit upload buffer**: queue local + proxied call records, flush to central with retry. The buffer is **signed + idempotent** (anti-replay / anti-under-report, DECISIONS §2) and feeds the single authoritative **`inference_calls`** ledger → C3 reconciliation and O1 audit.

## Key contracts / data

- `config_version`, config snapshot schema (incl. `feature_states` version), usage-report batch, Realtime channel auth (device token, RLS-scoped).

## UI surfaces

- Sync/offline status chips in the shell (D1).

## Reuse / source

Supabase Realtime; Sensei `EventManager`/transport + optimistic-rollback patterns.

## Open questions

- How much config to cache; conflict handling on reconnect.
