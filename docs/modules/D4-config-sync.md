# D4 · Config sync & offline

**Plane:** Device · **Status:** Planned · **Depends on:** C1 / Supabase Realtime, F2

## Purpose
Keep the device's view of org config fresh, work offline, and report usage back — the "subscribe to server, changes pushed" mechanism.

## What we build
- **Supabase Realtime subscription** (filtered by tenant via RLS) — admin edits config → client is notified.
- **Versioned pull**: a `config_version`; on notify or reconnect, pull the latest config (routers/models/chains/policies/budgets) and **hot-reload** the local engine (`update_config`). Provider **keys are not synced** — central custody; cloud calls proxy through C1.
- **Offline cache** in the local store (D1) so the app works without network (local models + last-known config).
- **Usage/audit upload buffer**: queue local + proxied call records, flush to central with retry → feeds C3 reconciliation and O1.

## Key contracts / data
- `config_version`, config snapshot schema, usage-report batch, Realtime channel auth (device token).

## UI surfaces
- Sync/offline status chips in the shell (D1).

## Reuse / source
Supabase Realtime; Sensei `EventManager`/transport + optimistic-rollback patterns.

## Open questions
- How much config to cache; conflict handling on reconnect; Realtime auth scoping.
