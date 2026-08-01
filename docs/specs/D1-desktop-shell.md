# D1 · Desktop shell & local store — Spec

**Module:** [D1](../modules/D1-desktop-shell.md) · **Status:** Planned (build-ready) · **Plane:** Device
**Depends on:** [F2](./F2-identity-auth-rbac.md) (client-only session, device enrollment, device-status), [W2](../modules/W2-member-console.md) (hosted member UI), [W4](../modules/W4-design-system.md) (shell atoms/tokens) · the `sensei-*` crates @ `v0.4.6` (hosted, driven by D2/D3)
**Enables:** [D2](../modules/D2-local-gateway.md) (host for the embedded engine + Local Models screen), [D3](../modules/D3-split-plane-router.md) (host + local store for the router), [D4](../modules/D4-config-sync.md) (owns the local config snapshot + signed usage buffer this module persists), [O3](../modules/O3-device-fleet.md) (device identity + buffer-health signal)
**Date:** 2026-07-23 · **Authority:** [`../DECISIONS.md`](../DECISIONS.md) §2 (W1 self-owned writes, W4 no device-side keys, apply-without-asking: device-status + signed offline buffers), §3 (embedded in-process local engine, RS256/JWKS). Where anything here disagrees with `DECISIONS.md`, that record wins.

---

> **Scope boundary (read first).** D1 is the **Tauri 2 host** and the **device-local store** — the process, window/tray/menu lifecycle, the OS-keychain wrapper, the client-only session, the offline/degraded shell states, and the on-disk SQLite store that D3/D4 read and write. D1 **hosts but does not own**: the W2 member console UI (W2), the embedded local engine + model manager + Local Models screen (D2), the per-request local-vs-cloud routing decision (D3), and config-sync/Realtime/buffer-flush logic (D4). This spec fixes the **IPC command/event surface**, the **local-store schema**, and the **keychain/session contract** those modules build on.

---

## 1. Purpose & scope

Torii ships the Member Console as a **Tauri 2 + SvelteKit (Svelte 5)** desktop app so that inference can run **on-device** (offline, private, $0) while cloud steps proxy to the central gateway (C1). D1 is the shell that makes that possible and the sole owner of everything persisted on the device.

D1 is responsible for:

- The **Tauri host**: window, native menus, system tray, deep-link handling, single-instance, lifecycle, auto-update surface.
- A **thin, typed IPC layer** (Sensei pattern: subscribe-to-events-then-invoke; RAII in-flight guards) that keeps business logic in testable Rust libraries and exposes it to the SvelteKit frontend as commands + events.
- The **device-local store** — an embedded **SQLite (+ `sqlite-vec`)** database holding: the config snapshot (D4), the **signed + idempotent** offline usage/audit buffer (D3 writes, D4 flushes), a small key/value cache, and an **optional on-device 1024-dim RAG index** for the local/sensitive-data plane (§3c). No provider secrets ever land here.
- **OS keychain** custody of the **device session material only** — the Ed25519 device keypair (F2 enrollment) and the persisted client-only Supabase session. **Never provider credentials** (those live only in the central F3 vault, DECISIONS §2 W4).
- **Client-only session** persistence + refresh for a server-less SPA (Kavach client-only mode), device-bound (the JWT carries `device_id`, F2 §4.1).
- **Offline / degraded shell states** and the cross-cutting **sync/device chips** (mockup-review Ground rules + item 39): offline banner, `EnvChip`, `DeviceFooter`, `DevicePill`, sync status ("synced · config v412" / "3 calls queued" / "flushing").
- The **Playwright E2E harness** against the built app (Sensei `tauri-playwright-testing` pattern).

**In scope:** the Tauri process + `src-tauri` Rust host, the IPC command/event contracts, the local SQLite store schema + access traits, the keychain wrapper, the client-only session store, shell-state derivation, tray/menu/deep-link, offline/degraded UX shell chrome, E2E.

**Out of scope (owned elsewhere, hosted here):** the embedded engine + resolvers + model manager (D2); the local-vs-cloud routing decision + unified trace (D3); Realtime subscription, versioned config pull, `Gateway::update_config` hot-reload, and buffer-flush reconciliation (D4); the member console screens themselves (W2) and Playground (W3); device enrollment/RBAC semantics + the device-status hot-path *authority* (F2/C1 — D1 only mirrors status for UX); the central ledger + fleet analytics (O1/O3).

**Depends on:** F2 (session/device/JWT), W2 (UI it hosts), W4 (shell atoms). **Enables:** D2, D3, D4, O3.

---

## 2. Responsibilities

1. **Host the Tauri process**: window creation/restore, native menu bar, system tray + menu, single-instance guard, deep-link (`torii://…`) routing to SvelteKit routes, graceful shutdown that drains in-flight IPC and flushes the buffer.
2. **Expose a thin typed IPC surface** (§4.2/4.3) so the frontend never talks to the OS, filesystem, keychain, or SQLite directly; all privileged host actions are RAII-guarded commands, and host state changes are pushed as events.
3. **Own the device-local store** (§3/§4.4): open/migrate the SQLite DB under the app data dir, expose a `LocalStore` trait to D2/D3/D4, enforce single-active-tenant segregation, and vacuum/GC.
4. **Custody device session material in the OS keychain** (§5.2): generate/load the Ed25519 device keypair, persist the client-only Supabase session (refresh token) encrypted-at-rest by the OS keychain; expose signing for the offline buffer and enrollment challenge. Never store or accept a provider credential.
5. **Run the client-only session** (§4.2, §6.1): sign-in via the Kavach/Supabase client methods, persist + auto-refresh the session, attach `device_id`, expose the current access token to the C1 client (D3) and to Supabase (D4). Purge on sign-out / tenant-switch.
6. **Persist the signed offline usage/audit buffer** (§4.4, §5.3): accept call records from D3, sign each with the device key, assign a monotonic per-device sequence + idempotency key, store durably; expose them to D4 for flush; surface pending-count + buffer-health.
7. **Derive and broadcast shell state** (§4.5, §6.3): network reachability, local-engine readiness (from D2), sync status + config version (from D4), device status (active/revoked, mirrored from D4's Realtime signal), and drive the offline/degraded chrome + locked-toggle rendering.
8. **Provide the E2E harness** (§9): globalSetup, test-mode flags, a `TauriPage` driver, deterministic offline simulation.

---

## 3. Data model — the device-local store (NOT F1/Postgres)

D1 owns **no** F1 (Postgres) tables. Its store is a **device-local SQLite database** (`~/<app-data>/torii/local.db`, `sqlite-vec` extension loaded) that **caches or buffers** F1 data; the authoritative copy always lives centrally. All tables carry `tenant_id` and are scoped to the **single active tenant** (§5.4).

### 3.1 Local-store engine decision — **SQLite + `sqlite-vec`** (RESOLVED, see §8.1)

The store is **SQLite** with the **`sqlite-vec`** extension for the 1024-dim vector index (chosen over embedded Postgres + `pgvector` — rationale in §8.1). Accessed from Rust via `rusqlite`/`tauri-plugin-sql`; `sqlite-vec` provides a `vec0` virtual table storing `float[1024]` with brute-force + metadata-filtered KNN, sufficient for a single-user/single-device corpus.

### 3.2 Tables (device-local)

| Table | Purpose | Writer | Reader |
|-------|---------|--------|--------|
| `config_snapshot` | `config_version int`, `payload jsonb`, `etag`, `fetched_at` — the last-pulled org config (routers/models/chains/policies/budgets + `feature_states`) for offline use. Single active row + short history for rollback. | D4 | D3 (routing), shell (governance/locked-toggles), D2 (engine `update_config`) |
| `usage_buffer` | `id uuid`, `seq int` (monotonic per device), `idempotency_key`, `tenant_id`, `kind (call\|audit)`, `payload jsonb`, `signature`, `created_at`, `flushed_at nullable`, `attempts int` — the **signed + idempotent** offline call/audit records feeding the single `inference_calls` ledger + O1. | D3 (enqueue via D1), D1 (signs) | D4 (flush) |
| `kv` | `key text pk`, `value jsonb`, `updated_at` — device_id, active tenant_id, last-sync marker, cached user_preferences (read model), last-known device status, UI state. No secrets. | D1/D4 | shell, D3 |
| `local_docs` | `doc_id`, `tenant_id`, `space_id`, `title`, `classification`, `content_hash`, `source_ref`, `updated_at` — metadata for docs indexed **on-device** (local/sensitive-data plane only). | D2/C5-local | D3 |
| `local_chunks` | `chunk_id`, `doc_id`, `ordinal`, `text`, `meta jsonb` — chunk text for the local index. | D2/C5-local | D3 |
| `local_vec` (`vec0`) | `chunk_id`, `embedding float[1024]` — the **1024-dim** on-device RAG index (matches F1 `document_embeddings vector(1024)`; embed model supplied by D2, DECISIONS §3). | D2/C5-local | D3 |

`schema_meta(version)` tracks the local-store migration version; D1 runs forward migrations on startup.

### 3.3 F1 (central) tables this module reads/relates to

- **`devices`** (F2/`app`, §3.1 of F2): D1 provides the `pubkey` (from the keychain keypair) at enrollment and persists the returned `device_id` in `kv`; it **reads** `devices.status` **only via D4's Realtime mirror** for UX (the *authoritative* hot-path check is C1/F2 §5.7 — D1 never gates spend itself). D1 also feeds `devices.buffer_health` (pending count, oldest-unflushed age) up through D4/O3.
- **`config.*` catalog / `public.fallback_chains` / `budget_nodes` / `feature_states` / `user_preferences`**: never written by D1; consumed as the read-only `config_snapshot` that D4 pulls.
- **`inference_calls`** (single `service_role` ledger, F1): D1 never writes it; it buffers signed records that D4 flushes into it centrally.

---

## 4. Contracts

All contracts are **frozen shapes** for D2/D3/D4/W2 to build against. IPC follows the Sensei convention: **commands** are `invoke`-able (request→response, RAII in-flight guard); **events** are host→frontend pushes the frontend subscribes to on mount.

### 4.1 Namespacing & error model

- Commands are namespaced `d1_<area>_<verb>` (e.g. `d1_store_enqueue_usage`); auth/device commands reuse F2's names verbatim (§4.7 of F2) so the session contract is shared.
- Events use `torii://<area>/<name>` (e.g. `torii://shell/sync-status`).
- Every command returns `Result<T, IpcError>` where `IpcError = { code: enum, message, retryable: bool }`, `code ∈ { Unauthenticated, DeviceRevoked, Offline, StoreError, KeychainError, EngineNotReady, Conflict, Internal }`. The frontend maps `code` to shell UX (e.g. `DeviceRevoked` → hard sign-out + revoked screen; `Offline` → queued affordance).

### 4.2 Session & device commands (shared with F2 §4.7)

```ts
auth_sign_in({ provider?: 'google'|'github', email?, password? }) -> Session   // Kavach client-only
auth_sign_out() -> void                                    // purges session + wipes tenant-scoped store (§5.4)
auth_current() -> Session | null                           // { access_token, expires_at, tenant_id, device_id? }
auth_switch_tenant(tenant_id) -> Session                   // re-mints token (bumps claims_version); re-scopes store
device_enroll() -> { device_id }                           // loads/creates keypair, signs nonce, POST /rpc/devices/enroll
device_status() -> 'active' | 'revoked'                    // mirrors D4 Realtime cache for UX only
```

`Session` never contains a provider credential. `access_token` is a short-TTL (1h, F2 §4.1.1) RS256 JWT; D1 auto-refreshes before expiry and re-emits `torii://shell/session-changed`.

### 4.3 Store, keychain & shell commands (D1-owned)

```ts
// ── local config snapshot (D4 writes, everyone reads) ──
d1_store_get_config() -> { config_version, payload, fetched_at } | null
d1_store_put_config({ config_version, payload, etag }) -> void          // D4 only

// ── signed offline usage/audit buffer (D3 enqueues, D4 flushes) ──
d1_store_enqueue_usage({ kind: 'call'|'audit', payload }) -> { id, seq } // D1 signs + assigns seq/idempotency_key
d1_store_pending_usage({ limit?, tenant_id }) -> BufferRecord[]          // D4 flush read; returns signed records
d1_store_mark_flushed({ ids: string[] }) -> void                        // D4 after server ack (idempotent)
d1_store_buffer_health() -> { pending, oldest_unflushed_at, last_flush_at, failed }

// ── kv cache ──
d1_store_kv_get(key) -> value | null
d1_store_kv_set(key, value) -> void                                     // non-secret only; rejects known-secret keys

// ── on-device RAG index (§3c local plane; D2/C5-local) ──
d1_store_index_upsert({ doc, chunks: {ordinal,text,embedding}[] }) -> void   // embedding = float[1024]
d1_store_index_search({ space_id?, query_embedding, k, filters? }) -> Hit[]  // KNN + metadata filter
d1_store_index_delete({ doc_id }) -> void

// ── shell + host ──
d1_shell_state() -> ShellState                                          // snapshot (also pushed as events)
d1_shell_open_deeplink(url) -> void                                     // routes torii://… to a SvelteKit route
d1_shell_set_offline_sim(on: bool) -> void                             // TEST-MODE ONLY (§9); no-op in prod builds
```

**Keychain private-key material is never returned to JS.** Signing happens in Rust (`d1_store_enqueue_usage` signs internally; enrollment challenge signed inside `device_enroll`). There is no `get_private_key` command by construction (§5.2).

### 4.4 Rust host traits (implemented in `src-tauri`, consumed by D2/D3/D4)

```rust
/// Device-local persistence. Single active tenant (§5.4).
pub trait LocalStore: Send + Sync {
    fn get_config(&self) -> Result<Option<ConfigSnapshot>, StoreError>;
    fn put_config(&self, snap: ConfigSnapshot) -> Result<(), StoreError>;      // D4
    fn enqueue_usage(&self, rec: UsageRecord) -> Result<Buffered, StoreError>; // signs + seq (§5.3)
    fn pending_usage(&self, tenant_id: Uuid, limit: usize) -> Result<Vec<Buffered>, StoreError>; // D4
    fn mark_flushed(&self, ids: &[Uuid]) -> Result<(), StoreError>;            // idempotent
    fn buffer_health(&self) -> Result<BufferHealth, StoreError>;
    fn kv_get(&self, key: &str) -> Result<Option<Value>, StoreError>;
    fn kv_set(&self, key: &str, val: Value) -> Result<(), StoreError>;
    // on-device 1024-dim RAG index (local/sensitive plane)
    fn index_upsert(&self, doc: LocalDoc, chunks: Vec<LocalChunk>) -> Result<(), StoreError>;
    fn index_search(&self, q: &[f32; 1024], k: usize, f: IndexFilter) -> Result<Vec<Hit>, StoreError>;
    fn purge_tenant(&self, tenant_id: Uuid) -> Result<(), StoreError>;         // sign-out / switch (§5.4)
}

/// OS keychain custody — device keypair + client session only. NEVER provider secrets.
pub trait DeviceKeychain: Send + Sync {
    fn ensure_keypair(&self) -> Result<Ed25519Pub, KeychainError>;   // create-or-load; private key never leaves Rust
    fn sign(&self, bytes: &[u8]) -> Result<Signature, KeychainError>;// buffer records + enroll challenge
    fn store_session(&self, s: &PersistedSession) -> Result<(), KeychainError>;
    fn load_session(&self) -> Result<Option<PersistedSession>, KeychainError>;
    fn clear_session(&self) -> Result<(), KeychainError>;            // sign-out
}

/// Shell state broadcast to the frontend (§4.5).
pub trait ShellStateSource: Send + Sync {
    fn snapshot(&self) -> ShellState;
    fn subscribe(&self) -> Receiver<ShellState>;   // drives events
}
```

### 4.5 Shell state + events

```ts
type ShellState = {
  network:  'online' | 'degraded' | 'offline';      // degraded = Supabase reachable, C1 not (or vice-versa)
  engine:   'ready' | 'loading' | 'unavailable';    // from D2
  sync:     { status: 'synced'|'syncing'|'stale'|'offline'; config_version: number|null; last_sync_at?: string };
  buffer:   { pending: number; flushing: boolean; failed: number };
  device:   'active' | 'revoked' | 'unknown';       // mirror of D4 Realtime signal (UX only)
  plane_hint: 'desktop';                             // StrategosEnv capability flag (enables local-only UI)
};
```

Events (host → frontend):

| Event | Payload | Emitted when |
|-------|---------|--------------|
| `torii://shell/network-changed` | `{ network }` | reachability probe to Supabase/C1 changes |
| `torii://shell/engine-status` | `{ engine }` | D2 engine load/ready/crash |
| `torii://shell/sync-status` | `{ status, config_version, buffer }` | D4 pull / buffer flush progress |
| `torii://shell/device-status` | `{ device }` | D4 Realtime `devices` update (revoke → force sign-out) |
| `torii://shell/session-changed` | `{ authenticated, tenant_id, expires_at }` | sign-in/out, refresh, tenant switch |
| `torii://shell/deep-link` | `{ path, params }` | OS delivers a `torii://` URL |
| `torii://shell/menu` | `{ id }` | tray/native-menu item activated |

### 4.6 Tray, menus, window

- **System tray**: status glyph reflecting `ShellState.network`/`device`; menu = Open, Ask (deep-link to `/ask`), Sync now (→ D4), Offline pending: N (opens Activity), Sign out, Quit.
- **Native menu bar**: standard app/file/edit/view/window + a **Torii** menu (Local models `[D]`, Device & sync, Preferences) routing via deep-link; menu items disabled per `ShellState` (e.g. "Sync now" disabled offline).
- **Window**: single-instance (second launch focuses the existing window + forwards the deep-link); restore last route + size; on quit, drain in-flight commands and attempt a final buffer flush (best-effort, bounded).
- **Auto-update**: Tauri updater surface (check/apply); the "gateway v2.4" version label from the mockups is **dropped** (mockup-review item 44) — the engine version (`sensei-*` v0.4.6) is not user-facing.

---

## 5. Security & RLS

D1 is a client; it holds **no** service role and enforces **no** authorization decisions of record — every privileged read/write is RLS-scoped in Postgres or capability-checked in C1. D1's security job is **custody, isolation, and non-forgeability** on the device.

### 5.1 Capabilities & locked controls (client-side rendering only)

D1 renders the shell chrome and gates local-only UI via the `StrategosEnv`/`plane_hint` flag; it renders admin-governed toggles as **locked** (greyed + lock + tooltip) from the `config_snapshot` `feature_states`/`user_preferences` read model per the 4-state governance precedence (DECISIONS §4). This is **UX only** — the authoritative check is server-side; a tampered client that unlocks a control still fails at C1/RLS. Self-owned benign writes (own `user_preferences`, own drafts) go direct to PostgREST under RLS; all privileged writes go through C1 `/rpc/*` (never from the device shell).

### 5.2 Keychain & secret custody (DECISIONS §2 W4)

- **Provider credentials never reach the device.** There is no code path, command, store column, or keychain entry for a provider API key/OAuth token; cloud inference proxies through C1 which injects the decrypted credential server-side. A build-time assertion + a log/store scan test enforce this (§9).
- The **only** secrets on-device are the **Ed25519 device private key** and the **client session refresh token**, both in the **OS keychain** (Keychain Services / Windows Credential Manager / libsecret via the Tauri stronghold/keychain plugin), never in SQLite, never in plaintext files, never logged.
- The private key **never crosses the IPC boundary to JS**; signing is a Rust-only operation (`DeviceKeychain::sign`). No `get_private_key`-shaped command exists.

### 5.3 Offline buffer non-forgeability (DECISIONS §2 apply-without-asking)

Every buffered usage/audit record is **signed with the device key** and carries a **monotonic per-device `seq`** + an **idempotency key**. This makes the buffer **anti-replay** (server rejects a re-used idempotency key; a gap/rewind in `seq` is flagged) and **anti-under-report** (the server can detect a missing `seq`, so a device cannot silently drop spend). Records are immutable once enqueued (append-only; only `flushed_at`/`attempts` mutate). D4 flushes; the server verifies the signature against the enrolled `devices.pubkey` before accepting into `inference_calls`. Local calls are `$0` but still logged so budgets stay unified (D3).

### 5.4 Device-local tenant isolation

The store is scoped to **one active tenant** at a time (F2 §8.5 single-tenant-per-token). `auth_switch_tenant` and `auth_sign_out` call `LocalStore::purge_tenant` for the departing tenant (config snapshot, kv, and the local RAG index) so a shared machine / multi-tenant user cannot read another tenant's cached config or on-device documents. The signed usage buffer is retained across switch **only** until flushed (records are tenant-tagged and flush to their own tenant), then GC'd. On-device documents (§3c sensitive plane) are wiped on sign-out.

### 5.5 Device revocation (UX mirror; authority is C1)

D1 subscribes (via D4) to the Realtime `devices` signal; on `status='revoked'` it emits `torii://shell/device-status revoked`, force-signs-out, wipes the session from the keychain, and shows the revoked screen. This is **defense-in-depth for UX** — the enforcement of record is C1's per-request device-status check (F2 §5.7 / C1 §6.1): a revoked device with a live JWT cannot spend even if a tampered client ignores the event.

### 5.6 Redaction / PII on-device

D1 stores no chat content beyond what the on-device RAG index needs for the local/sensitive plane. On-device indexed content follows **redact-at-rest** (DECISIONS §2 W5): secret/PII detection + one-way placeholder redaction happens in the C5/D2 ingestion path **before** text/embeddings are written to `local_chunks`/`local_vec`; D1's store never holds raw secrets. Sensitive structured-data values (§3c) are pinned on-device and never egress — the local plane is *why* the index exists.

---

## 6. Key flows

### 6.1 Cold start → client-only session

1. Tauri boots `src-tauri`; D1 opens/migrates `local.db`, loads the `sqlite-vec` extension, and reads `kv` (device_id, active tenant, last config_version).
2. `DeviceKeychain::load_session` → if a valid refresh token exists, refresh the Supabase session (RS256 access token) and emit `session-changed(authenticated)`; else route the SvelteKit frontend to the Sign-in screen.
3. D1 probes reachability → sets `ShellState.network`; starts D4 (Realtime subscribe + config pull) and D2 (engine load) which push `sync-status`/`engine-status`.
4. Frontend (W2) mounts, subscribes to all `torii://shell/*` events, and calls `d1_shell_state()` for the initial snapshot.

### 6.2 First device enrollment (→ device-bound session)

1. After first sign-in on this device, frontend calls `device_enroll()`.
2. D1 `DeviceKeychain::ensure_keypair` → Ed25519 pubkey; requests a server nonce; `sign(nonce)`; `POST /rpc/devices/enroll {pubkey, name, platform, challenge_sig}` (F2 §6.2).
3. C1 verifies, inserts `devices(status='active')`, returns `device_id`; D1 persists it in `kv`; subsequent tokens carry the `device_id` claim.

### 6.3 Going offline → degraded shell

1. Reachability probe fails → `ShellState.network='offline'` (or `'degraded'` if only one of Supabase/C1 is down) → `network-changed` event.
2. Shell shows the **offline banner** ("cloud unreachable — local models still work"), `EnvChip` flips to offline, and cloud-only affordances render disabled with a `DesktopOnlyNote`/tooltip.
3. D3 routes local-capable requests to the embedded engine; cloud-only steps are queued or fail-with-local-fallback per D3 policy.
4. Ask/local inference proceeds against the cached `config_snapshot`; results are logged to `usage_buffer` (signed) with `ExecBadge` "on your device".

### 6.4 Capturing a call to the signed buffer

1. D3 completes a call (local `$0`, or a proxied cloud call whose record it wants durably queued) → `d1_store_enqueue_usage({kind:'call', payload})`.
2. D1 assigns `seq = last_seq+1`, generates an `idempotency_key`, signs `payload ‖ seq ‖ idempotency_key` with the device key, writes an append-only `usage_buffer` row, updates `buffer_health`, emits `sync-status`.
3. When online, D4 reads `pending_usage`, POSTs the signed batch to C1; on ack, `mark_flushed`. Duplicate delivery is safe (idempotency key); a dropped `seq` is server-detectable (§5.3).

### 6.5 Config change pushed from admin

1. Admin edits config (C1 `/rpc/*`) → Supabase Realtime notifies D4 (RLS-scoped channel, device-token authed).
2. D4 pulls the new versioned snapshot, calls `d1_store_put_config`, and asks D2 to hot-reload the engine (`Gateway::update_config`).
3. D1 emits `sync-status {status:'synced', config_version}`; the shell chip updates ("synced · config vN"); locked-toggle rendering re-derives from the new `feature_states`.

### 6.6 Device revoked while running

1. Admin revokes the device → Realtime `devices` update → D4 → `d1_shell_state.device='revoked'` + `device-status` event.
2. D1 force-signs-out, `clear_session`, wipes tenant-scoped store, shows the revoked screen. Even before the event lands, C1 rejects the next inference call `403 device_revoked` (authority), so spend stops regardless (§5.5).

### 6.7 Shutdown

Quit drains in-flight IPC (RAII guards), attempts one bounded buffer flush if online, checkpoints SQLite (WAL), and persists last route/window state.

---

## 7. Gateway-crate dependencies (+ GH-issue refs)

D1 **hosts** the engine but adds no engine capability itself; the crate work D1 depends on is owned by D2/D3.

- **Crates:** the desktop embeds the local wing of the six `sensei-*` crates @ **`v0.4.6`** — `sensei-local-engine` + `sensei-local-providers` (`EmbeddedLlamaAdapter` / `OrtAdapter`, in-process, **no daemon**) driven through `sensei-gateway`'s local wing (D2). D1's `src-tauri` `Cargo.toml` pins these at the `v0.4.6` git tag (`[patch]` for dev-in-place) — **MIG-3** in [`../plans/gateway-issues.md`](../plans/gateway-issues.md). There is **no `gateway-embedded`** and **no `InferenceAdapter`** — the old clients-buildout wording (`gateway-embedded` v0.2.23, `fastembed`) is superseded; `fastembed` is disabled.
- **[GH-3 — RESOLVED]** The 1024-dim on-device embedding path uses `EmbeddedLlamaAdapter`/`OrtAdapter` (no crate change); D1 only provides the `sqlite-vec` store to hold the vectors. No blocking crate work for the local index.
- **[GH-1 — blocking for D3, not D1]** Per-step `plane`/execution-location on `ChainEntry`/`Attempt`/`ExecutionTrace`. D1 surfaces the resulting per-step `ExecBadge` in the hosted UI but does not need the crate change to build the shell.
- **No D1-owned gateway issue.** D1's contracts (IPC, store, keychain) are Tauri/SQLite/OS concerns, independent of the engine crate.

---

## 8. Decisions resolved

### 8.1 Local store = **SQLite + `sqlite-vec`** (not embedded Postgres + `pgvector`)

*Decision:* the device store is **SQLite** with the **`sqlite-vec`** extension for the 1024-dim RAG index. *Rationale:*

- **In-process, no daemon** — matches the ratified desktop principle (DECISIONS §3: embedded in-process local engine, no external server). Embedded Postgres bundles/spawns a `postgres` server process + manages a port/socket + data dir lifecycle — a second daemon on every user's machine, contradicting the "no daemon" posture and multiplying crash/upgrade/permission surface. SQLite is a linked library with a single file.
- **Footprint & startup** — SQLite adds ~1 MB and opens instantly; a bundled Postgres adds tens of MB and a startup/shutdown supervisor. For a per-user desktop app this is decisive.
- **Vector fit** — `sqlite-vec` supports `float[1024]` vectors with brute-force + metadata-filtered KNN; a single device's corpus (local/sensitive-plane docs only — central RAG stays in C5/pgvector) is small enough that HNSW is unnecessary. Dim exactly matches F1 `document_embeddings vector(1024)` so a doc can move between planes without re-embedding.
- **Ecosystem** — `tauri-plugin-sql` + `rusqlite` are first-class in Tauri; the offline buffer + kv + config snapshot are *relational* needs SQLite already serves, so one store covers all four jobs.
- **Consistency with the 2026-07-06 blueprint** — clients-buildout §11 leaned "lightweight local store (SQLite), on-device retrieval deferred." This decision keeps SQLite and *adds the `sqlite-vec` index* only for the local/sensitive-data plane (§3c), which DECISIONS §3c explicitly wants pinned on-device. The full cloud RAG pipeline remains central (C5).

*Rejected:* embedded `pgvector` — reconsider only if on-device corpora grow past brute-force viability (then evaluate `sqlite-vec` ANN or a dedicated embedded ANN lib before a full Postgres).

### 8.2 On-device RAG index is **built now but scoped to the local/sensitive plane**

*Decision:* D1 ships the 1024-dim `local_vec` index in v1, but it holds **only** documents/datasets pinned to on-device execution (§3c "prefer the local plane for sensitive data"); general retrieval is central (C5). *Rationale:* reconciles the D1 module seed ("local RAG index, vector(1024)") with DECISIONS §3a (retrieval is C5) and §3c (sensitive values never leave the device). The index earns its place as the substrate for compute-without-exposing, not as a parallel cloud-RAG.

### 8.3 Device signing key = the **enrollment Ed25519 keypair** (one key)

*Decision:* the offline-buffer signature and the enrollment challenge use the **same** device Ed25519 keypair in the OS keychain. *Rationale:* the server already trusts `devices.pubkey` for enrollment (F2 §6.2); reusing it for buffer signatures means the server verifies buffered records against a key it already holds — no second key-distribution problem. Resolves the D1 seed's implicit "how is the buffer signed" gap.

### 8.4 Session model = **client-only Kavach session, device-bound, keychain-persisted**

*Decision:* desktop uses Kavach's client-only session mode (no SvelteKit server), refresh token in the OS keychain, `device_id` claim attached, auto-refresh in Rust. *Rationale:* DECISIONS + F2 §4.7; the SPA has no server to hold a cookie. Supersedes clients-buildout's "session in Tauri store/localStorage" — the **refresh token goes in the keychain**, not localStorage, to avoid a plaintext-at-rest secret.

### 8.5 Provider secrets are **structurally absent** from the device

*Decision:* no device code path can store/receive a provider credential; enforced by a scan test. *Rationale:* DECISIONS §2 W4 — closes the whole class of device-key-leak risk by construction rather than policy.

---

## 9. Acceptance criteria (observable)

1. **Boots on all three OSes** — `apps/desktop` launches on macOS/Windows/Linux, restores the last route + window, and the shell chrome (nav rail, `EnvChip`, `DeviceFooter`, tray) renders; the "gateway v2.4" label is absent.
2. **Client-only session persists + refreshes** — after sign-in, killing and relaunching the app restores an authenticated session from the keychain without re-login; the access token auto-refreshes before its 1h expiry (observable via `session-changed`), and no session token appears in SQLite or any log.
3. **Device enrollment** — `device_enroll()` produces a keypair, registers the pubkey, and persists a `device_id`; subsequent tokens carry the `device_id` claim (assert against the decoded JWT).
4. **Keychain custody** — the device private key is retrievable only inside Rust (`sign` works); no IPC command returns private-key bytes (grep-clean); the refresh token lives in the OS keychain, not `local.db`.
5. **No provider secret on device** — a store+log+keychain scan test finds zero provider-credential-shaped material; there is no command/column/keychain entry for one (build assertion + runtime scan).
6. **Local store round-trips** — `d1_store_put_config`/`get_config` returns the snapshot; `sqlite-vec` `index_upsert` of 1024-dim vectors + `index_search(k)` returns nearest chunks with metadata filters; a 1025- or 384-dim vector is rejected.
7. **Signed idempotent buffer** — `enqueue_usage` assigns a monotonic `seq` + idempotency key and a valid Ed25519 signature verifiable against the enrolled pubkey; re-enqueuing the same record is deduped; `mark_flushed` is idempotent; `buffer_health` reports the correct pending count.
8. **Offline shell** — with the network simulated off (`d1_shell_set_offline_sim(true)` in test mode), the offline banner shows, cloud-only controls disable, a local Ask still returns an answer with `ExecBadge` "on your device", and the call lands in `usage_buffer`; on reconnect, D4 flushes it and the sync chip returns to "synced · config vN".
9. **Sync chips reflect state** — `sync-status`/`network-changed`/`engine-status` events drive the `DeviceFooter`/`DevicePill` chips ("synced · config v412", "3 calls queued", "flushing"); values match `d1_shell_state()`.
10. **Device revocation force-signs-out** — a Realtime `devices` revoke emits `device-status revoked`, clears the keychain session, wipes the tenant-scoped store, and shows the revoked screen; a subsequent inference attempt is rejected `403 device_revoked` by C1 regardless of the client.
11. **Tenant isolation on device** — after `auth_switch_tenant`/`auth_sign_out`, `purge_tenant` leaves zero rows of the departing tenant's config snapshot, kv, or local RAG index (assert empty); unflushed buffer rows retain their original tenant tag until flushed.
12. **Locked toggles** — a `feature_states` entry that is `locked`/not `user-overridable` renders the control greyed with a lock + tooltip from the `config_snapshot`, and the direct-write path is absent client-side (server would reject anyway).
13. **Deep-link + single-instance** — a second `torii://ask?...` launch focuses the existing window and routes to `/ask` (no second process).
14. **E2E green** — the Playwright harness (globalSetup, test-mode flags, `TauriPage`) runs the sign-in → local-Ask → offline → reconnect-flush path headless and passes; lint + tests clean (zero-errors policy).

---

## 10. Open questions

1. **Reachability semantics for `degraded`** — when Supabase is reachable but C1 is not (or vice-versa), is the correct UX one `degraded` banner or two independent chips (config-plane vs execution-plane)? Leaning one `degraded` state with a tooltip breakdown; confirm with the designer against mockup-review item 39. Does not block the shell build.
2. **How much config to cache offline** (shared with D4 open question) — the full snapshot vs a pruned subset (e.g. drop other spaces' settings). D1 stores whatever D4 hands it; the pruning decision is D4's. Flagged here only because it sizes `local.db`.
3. **Auto-update channel/signing** — Tauri updater endpoint, update signing key custody, and staged rollout vs immediate are a release-engineering decision (not security-of-record); defer to the packaging phase.
4. **`sqlite-vec` distribution** — bundle the extension binary per-platform vs compile-in; pick at the D1 implementation phase (compile-in preferred for a single artifact). No design impact.
5. **On-device index size cap / GC policy** — when the local/sensitive-plane corpus grows, what evicts (LRU by space, size cap)? Deferred until §3c usage data exists; brute-force is fine at v1 scale (§8.1).
