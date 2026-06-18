# D1 · Desktop shell & local store

**Plane:** Device · **Status:** Planned · **Depends on:** F2, W2, W4

## Purpose
The Tauri host that runs the Member Console locally, hosts the embedded engine, and owns on-device data.

## What we build
- **Tauri 2 + SvelteKit (Svelte 5)** shell loading the W2 Member Console UI.
- **Thin IPC commands** wrapping Rust logic (Sensei pattern: subscribe-to-events-then-invoke; RAII in-flight guards), keeping business logic in libraries for testability.
- **Local store**: embedded **SQLite** (or embedded Postgres if local RAG needs pgvector) for config cache, local RAG index, and the offline usage buffer.
- **OS keychain** for the device session token (not provider keys — those stay central).
- Tray, native menus, deep-link navigation, lifecycle.
- **E2E** with Playwright against the app (Sensei harness pattern).

## UI surfaces
Hosts W2 (member console), W3 (playground), and the new Local Models screen (D2).

## Reuse / source
Sensei `app/` (Tauri commands/events, singleton runes state slices, optimistic-with-rollback, Playwright E2E, menu architecture).

## Open questions
- Embedded **SQLite vs Postgres** locally (driven by local-RAG vector needs — `sqlite-vec` vs embedded `pgvector`).
- Daemon vs in-process engine (lean in-process via Tauri commands, since it's per-user).
