# D4 · Config sync & offline — Spec

**Module:** [D4](../modules/D4-config-sync.md) · **Plane:** Device · **Status:** Planned — build-ready · **Depends on:** [F1](../specs/F1-data-model.md) (config/feature/ledger tables + RLS), [F2](../specs/F2-identity-auth-rbac.md) (device-bound JWT + device lifecycle + Ed25519 key custody), [C1](../specs/C1-gateway-service.md) (config-snapshot read + `/v1/usage/report` + Realtime auth), [C3](../specs/C3-budgets-metering.md) (signed usage buffer → `inference_calls` reconciliation), [O3](../modules/O3-device-fleet.md) (feature-state 4-state governance) · **Enables:** [D2](../modules/D2-local-gateway.md) (hot-reloaded local engine config), [D3](../modules/D3-split-plane-router.md) (per-step plane routing off the synced chains), [D1](../modules/D1-desktop-shell.md) (sync/offline shell chips), [O1](../modules/O1-ledger-audit.md)/[C3](../specs/C3-budgets-metering.md) (device-reported ledger + audit rows)
**Date:** 2026-07-23 · **Language:** Rust (Tauri host) + SvelteKit (Svelte 5) shell · **Local store:** SQLite (D1) · **Transport:** Supabase Realtime (WebSocket) + HTTPS to C1 · **Authoritative record:** [`../DECISIONS.md`](../DECISIONS.md) §2 (apply-without-asking: Realtime RLS-scoped, offline buffers signed + idempotent, device-status hot-path check), §3 (embedded local plane, one authoritative ledger), §4 (4-state feature governance)

---

> **Premise (DECISIONS §2 apply-without-asking).** *A device is never trusted and never authoritative.* Config flows **one way, server → device** (the device never writes config — no conflict to resolve). Usage/audit flows **device → server** through a buffer that is **Ed25519-signed, monotonically sequenced, and idempotent**, so a device can neither forge nor under-report spend, and a replay is a no-op. Supabase Realtime channels are **RLS-scoped by the user JWT** — a device sees only its own tenant's config and its own budget/device signals. Provider credentials are **never** synced to the device (F3 central custody; cloud calls proxy through C1).

---

## 1. Purpose & scope

D4 keeps the desktop app's view of org configuration **fresh, coherent, and offline-durable**, and reports device-side usage/audit back to the central ledger. It is the "subscribe-to-server, changes-pushed" mechanism plus the "work-on-a-plane" durability layer that lets the embedded engine (D2) and the split-plane router (D3) keep running when the network is gone.

D4 owns four responsibilities end-to-end:

1. **Subscribe** — hold RLS-scoped Supabase Realtime subscriptions (config, budget, device) authed with the device-bound user JWT; translate a change notification into a pull.
2. **Pull + hot-reload** — fetch a **versioned config snapshot** (routers/models/chains/routing-policies/budgets + resolved `feature_states` + settings/preferences) on notify, reconnect, or startup, and hot-reload the embedded engine via `sensei-gateway` `Gateway::update_config` / `try_update_config` without a restart.
3. **Cache offline** — persist the last-known-good snapshot + the local RAG index in the D1 SQLite store so the app works with no network (local models + last-known config + last-known budget headroom).
4. **Upload buffer** — queue local + proxied call records and device audit rows in a signed, idempotent, sequenced buffer and flush them to central (C3 `/v1/usage/report`, O1 audit) with retry, feeding the single authoritative `inference_calls` ledger for C3 reconciliation.

**In scope:** the Realtime subscription manager + auth, the snapshot schema + `config_version` semantics (including the `feature_states` version component), the snapshot pull/apply/hot-reload flow, the on-device cache schema (D4 owns the schema; D1 owns the physical SQLite store), the signed upload buffer (enqueue/sign/flush/ack/anti-replay), the reconnect reconciliation policy, and the Tauri IPC + Rust trait contracts the shell and D2/D3 consume.

**Out of scope (owned elsewhere, consumed here):** the central config assembly + `/v1/config/snapshot` handler authorization (C1 — D4 defines the wire contract it consumes); the budget cascade math and `/v1/usage/report` server-side verification + `inference_calls` write (C3); the immutable audit ledger integrity gate (O1); the device enrollment / Ed25519 keypair custody / `devices.status` lifecycle and the hot-path device-status check (F2); feature-state authoring + 4-state precedence resolution (O3 — D4 syncs the **resolved** result); the local engine + model registry (D2); the routing decision itself (D3); provider-credential custody (F3, never synced).

**Depends on:** F1 (config catalog + `feature_states` + `inference_calls` + `devices` DDL and RLS), F2 (device-bound JWT with `device_id` claim, Ed25519 device key, `devices.status`), C1 (serves the snapshot read + `/v1/usage/report`, issues Realtime auth), C3 (reconciles the uploaded buffer), O3 (feature-state governance model).

**Enables:** D2 (receives hot-reloaded `GatewayConfig`), D3 (routes off the synced plane-tagged chains + last-known budget headroom), D1 (renders sync/offline chips), C3/O1 (device-reported ledger + audit).

---

## 2. Responsibilities

1. Establish + maintain **RLS-scoped Supabase Realtime subscriptions** (config / budget / device channels) authed with the device-bound user JWT; auto-resubscribe on token refresh and network resume.
2. On notify / reconnect / cold-start, **pull the versioned config snapshot** for the caller's tenant + resolved feature layer, comparing the server `config_version` to the cached one (delta-aware).
3. **Validate + hot-reload** the pulled snapshot into the embedded engine (`try_update_config`), applying atomically or rejecting wholesale; persist the new snapshot as last-known-good only after a successful apply.
4. **Persist the offline cache** (snapshot + `config_version` + resolved feature states + budget headroom for the caller's leaf/ancestors + local RAG index) so the app boots and runs without network.
5. **Enqueue every device-side call** (local `$0` + proxied-through-C1) and device audit event into the signed upload buffer with a monotonic `buffer_seq` + idempotency key.
6. **Flush the buffer** to C3 `/v1/usage/report` (usage) and the central audit sink (O1) on connectivity, with exponential-backoff retry, and mark rows acked only on server confirmation.
7. **Reconcile on reconnect** — replace cached config with any newer server version (server-authoritative), replay queued self-owned benign mutations (preferences/own conversations) last-writer-wins, and adopt server-pushed budget headroom.
8. Maintain **device liveness signals** — update `devices.last_seen`, `devices.config_version`, and `devices.buffer_health` (queued/oldest/flushing) so O3's Device Fleet can surface drift and buffer backlog.
9. Surface **sync/offline state** to the D1 shell (synced / syncing / offline / degraded / config-drift / N-queued) via Tauri IPC + events.
10. **Fail closed on config, fail soft on transport** — a snapshot that fails validation is rejected (keep last-known-good); a network loss degrades to offline (local plane) rather than blocking the app.

---

## 3. Data model (F1 tables owned / used)

D4 introduces **one small central version artifact** and **the on-device SQLite cache schema**; every other table it touches is owned by F1/F2/C3/O3. Where D4 needs a column or artifact the built schema lacks, it is listed as a **required F1 delta** and coordinated into the F1 rework — not invented ad hoc.

### 3.1 Central — required F1 delta (D4-driven, into the F1 rework)

| Artifact | Schema | Role | Notes |
|---|---|---|---|
| `config.config_versions` | `config` | **NEW** — per-tenant monotonic config generation | `tenant_id uuid`, `version bigint not null` (monotonic), `components jsonb` (per-component sub-versions: `{catalog, routing, budgets, features, settings}`), `updated_at timestamptz`. `pk(tenant_id)`. Bumped by a trigger/`service_role` write on any config-affecting table (catalog overrides, `fallback_chains`/`fallback_chain_models`, `routing_policies`, `budget_nodes` cap/enforcement, `feature_states`, `settings`, `mcp`/`tool_allow_lists`). `authenticated` gets tenant-scoped `SELECT`; `service_role`-write-only. This is the single token D4 compares to decide "am I stale?". |
| `app.devices.config_version` | `app` | **used** (F2-owned) | D4 writes the applied snapshot version here on each successful hot-reload (`config_version bigint`); O3 Device Fleet reads it to flag drift. |
| `app.devices.last_seen`, `app.devices.buffer_health` | `app` | **used** (F2/RW10) | D4 updates `last_seen` on each sync heartbeat and `buffer_health jsonb` (`{queued, oldest_ts, last_flush_ts, flushing}`) on each enqueue/flush. |

> **Why a single `config_version` and not per-table ETags.** A device must apply a **coherent** config (a chain edit + the model it references must land together). One per-tenant monotonic `version` (with a `components` map for delta-aware partial pulls) gives an atomic "generation" the engine reloads as a unit. Rationale in §8/D3.

### 3.2 Central — read (as `authenticated` under RLS via PostgREST / read through C1's snapshot endpoint)

D4 reads **only** client-readable, non-secret config. All reads are tenant-scoped by RLS (`tenant_id = (auth.jwt()->>'tenant_id')::uuid`); the device never reads another tenant's rows.

- **Catalog:** `config.providers`, `config.models`, `config.model_endpoints` (+ `local_capable`), `config.model_capabilities`, `config.capabilities`, catalog **override** tables (per-tenant/space/role enable + pricing, RW10).
- **Routing:** `public.fallback_chains`, `public.fallback_chain_models` (+ per-step `plane` local|cloud), `chain_bindings`, `routing_policies` (C2 — retry/timeout/region/health as operator config), `provider_health` (advisory).
- **Budgets (read-only headroom):** `budget_node_status` view (C3) scoped to the caller's leaf + ancestors — the device caches *last-known headroom* to inform D3/free-floor while offline; it is **never** authoritative (server re-pushes on reconnect).
- **Feature governance:** `config.feature_states` (4-state, `tenant_id`+RLS), `app.settings` (workspace + space scope), `app.user_preferences` (own row) — D4 syncs the **resolved** feature layer for the caller (O3 owns resolution; D4 consumes the resolved map, see §4.3).
- **Knowledge metadata (for offline UX + local RAG scoping):** `app.spaces`, `app.space_members` (own memberships), `app.documents` metadata (ids/titles/classification/space) — *content* and the local RAG index sync per D2/C5 policy, not here.
- **Tools:** `mcp_servers`, `tenant_mcp_servers`, `tool_allow_lists` for the caller's (role×space) — so local/offline tool-calling honors the allow-list (X1 enforces at call time; D4 only caches the list).
- **Identity:** `core.tenants` (name/region — RW10 read grant).

> **Never read/synced:** `public.router_credentials` / `core.tenant_keys` (RLS deny-all to `authenticated`; F3 central custody — DECISIONS §2 W4), `budget_holds` (`service_role`-only), any other tenant's rows, the full `inference_calls` ledger (device reads only its own device-reported rows for reconciliation display).

### 3.3 Central — write (via C1 RPC only, never direct PostgREST to privileged tables)

- `public.inference_calls` — device-reported local/cloud calls, written **by C3** as `service_role` when D4 flushes the signed buffer to `POST /v1/usage/report` (§4.5). D4 never writes the ledger directly.
- `audit_events` — device-side audit rows (e.g. `config.applied`, `sync.failed`, local governance/redaction hits) uploaded via the same buffered path; written `service_role`-only, `actor_id` bound (O1 integrity gate).
- **Self-owned benign writes** (allowed direct PostgREST under RLS, per DECISIONS §2 W1): the caller's own `app.user_preferences` and own `app.conversations`/`messages`. D4 queues these as offline mutations (§4.6) and replays them on reconnect — they are ownership-gated in RLS, not capability-gated.

### 3.4 On-device — SQLite cache schema (D4 owns the schema; D1 owns the physical store)

Stored in the D1 embedded SQLite DB (D1 open question SQLite-vs-Postgres — D4 is store-agnostic; needs KV + append tables + the `vector(1024)` RAG index D1/D2 provide).

| Table | Columns | Purpose |
|---|---|---|
| `cached_snapshot` | `component text pk`, `version bigint`, `payload jsonb`, `applied_at` | Last-known-good config, one row per component (`catalog`/`routing`/`budgets`/`features`/`settings`/`tools`). Reassembled into a `GatewayConfig` on cold start. |
| `sync_meta` | `key text pk`, `value` | `config_version` (last applied), `feature_version`, `last_sync_ok_ts`, `last_notify_ts`, `jwt_expiry`, `device_id`. |
| `usage_buffer` | `id integer pk`, `buffer_seq integer`, `idempotency_key text unique`, `payload jsonb`, `signature blob`, `status text` (`pending\|acked`), `created_at` | Append-only local/proxied call records awaiting flush (§4.4/4.5). `buffer_seq` monotonic per device. |
| `audit_buffer` | `id integer pk`, `buffer_seq integer`, `idempotency_key text unique`, `payload jsonb`, `signature blob`, `status text` | Device-side audit events awaiting flush. |
| `pending_mutations` | `id integer pk`, `kind text` (`preference\|conversation\|message`), `payload jsonb`, `base_modified_at`, `status text` | Self-owned benign writes made offline, replayed on reconnect (§4.6). |

The private Ed25519 device key lives in the **OS keychain** (F2/D1), never in SQLite. Buffer rows store the signature, not the key.

---

## 4. Contracts

### 4.1 Realtime subscriptions (Supabase, RLS-scoped by the user JWT)

D4 opens Supabase Realtime channels over the authenticated WebSocket, passing the device-bound access token; **Realtime RLS authorization** ([`../DECISIONS.md`](../DECISIONS.md) §2) ensures each channel only delivers rows the JWT may `SELECT`. Channels are re-subscribed on token refresh (F2 1-hour TTL) and on network resume.

| Channel | Scope (RLS) | Payload → D4 action |
|---|---|---|
| `tenant:{tenant_id}:config` | rows where `tenant_id` = JWT tenant | `config_versions` bump → **pull snapshot** (§4.4). Postgres-changes on catalog/routing/feature/settings tables also fire this bump. |
| `tenant:{tenant_id}:budget` | caller-visible `budget_node_status` (leaf + ancestors) | headroom/cap change → **update cached headroom**, push to D3 + spend chips. |
| `device:{device_id}` | the caller's own `devices` row | `status` change → if `revoked`, **stop the local engine's spend path + surface a hard offline-revoked state** (mirrors C1's hot-path gate, F2 §5.7); `config_version` mismatch echo → pull. |

Auth: the channel bearer is the same RS256 Supabase JWT C1 verifies (F2 §4.1); a device-bound session carries the `device_id` claim. On JWT expiry the socket is re-authed with the refreshed token; on `TokenStale`/`DeviceRevoked` D4 tears down subscriptions and enters the offline-revoked state.

### 4.2 HTTP — config snapshot pull (D4 consumes; served centrally by C1)

```
GET /v1/config/snapshot?since={version}         Authorization: Bearer <jwt|device jwt>
```
Returns the coherent versioned snapshot for the caller's tenant + resolved feature layer. `since` is the device's last-applied `config_version`; the server responds with a **full** snapshot (`since` absent or older than a retained delta horizon) or a **delta** (only changed components) with the new top `version`.

**Response (full):**
```jsonc
{
  "config_version": 412,
  "components": { "catalog": 88, "routing": 140, "budgets": 51, "features": 133, "settings": 20, "tools": 9 },
  "catalog":  { "providers": [...], "models": [...], "model_endpoints": [...], "model_capabilities": [...] },
  "routing":  { "chains": [...], "chain_models": [ { "step": 0, "model_id": "...", "plane": "cloud" }, ... ],
                "chain_bindings": [...], "routing_policies": [...] },
  "budgets":  { "leaf_node_id": "uuid", "headroom": [ { "node_id": "...", "cap": 100.0, "spent": 40.0, "reserved": 5.0, "headroom": 55.0, "free_floor_enabled": true } ] },
  "features": { "resolved": { "playground.compare": "default-on", "rag.graph": "locked-off", "ask.judge": "user-overridable" }, "feature_version": 133 },
  "settings": { "workspace": {...}, "spaces": { "space-uuid": {...} } },
  "tools":    { "servers": [...], "allow_list": [ { "space_id": "...", "role_id": "...", "tools": ["..."] } ] }
}
```
**Response (delta):** same envelope, only changed component keys present + the new `config_version`. `304 Not Modified` when `since == config_version`.

> **Credentials are absent by construction** — the snapshot carries model/endpoint/routing *config* only; no `router_credentials`, keys, or tokens (DECISIONS §2 W4). Cloud steps in a synced chain are marked `plane: "cloud"` and execute only by proxying to C1 (D3), which injects the credential server-side.

> **Serving path.** C1 (the config authority, [C1 §6.6](../specs/C1-gateway-service.md)) serves this read from the same assembled config + the RLS-readable feature/budget views; equivalently a device may assemble it from RLS-scoped PostgREST SELECTs, but the endpoint guarantees an **atomic generation** (one `config_version` across all components). D4 consumes the endpoint; C1 owns its authorization + handler.

### 4.3 Feature-state resolution (D4 syncs the resolved result; O3 owns resolution)

The 4-state governance model (`locked`/`default-on`/`default-off`/`user-overridable`) with precedence **workspace → space → role → user** ([`../DECISIONS.md`](../DECISIONS.md) §4) is **resolved server-side** (O3) into the flat `features.resolved` map above, carrying a `feature_version` component. D4 does **not** re-run precedence on-device; it caches the resolved map and re-pulls when `feature_version` bumps. A `user-overridable` feature the member toggles is a self-owned write to `user_preferences` (§4.6) that bumps `feature_version` on the server and re-resolves. This keeps the device from ever computing an authoritative governance decision.

### 4.4 HTTP — signed usage buffer flush (D4 → C3)

D4 flushes to the C3 contract ([C3 §4.4](../specs/C3-budgets-metering.md)); D4 owns enqueue/sign/sequence, C3 owns verify/persist.

```
POST /v1/usage/report        Authorization: Bearer <device jwt>
```
```jsonc
{
  "device_id": "…", "tenant_id": "…", "leaf_node_id": "…",
  "buffer_seq": 42,                       // monotonic per device (anti-replay)
  "idempotency_key": "device:{device_id}:seq:42",
  "calls": [ { "call_id": "uuid", "capability": "text_chat", "model": "…",
               "execution_location": "local", "input_tokens": 512, "output_tokens": 128,
               "cost_usd": 0.0, "recorded_at": "…", "trace": {...} } ],
  "signature": "ed25519(device_privkey, canonical(payload))"
}
```
**Server (C3) rejects** on: invalid signature, `devices.status != active` (revoked device cannot spend — DECISIONS §2), `buffer_seq ≤ last accepted` (replay), or `idempotency_key` already seen (duplicate → **200 no-op** ack, not an error). Accepted calls are inserted into `inference_calls` (`execution_location='local'`, `cost_usd` typically 0 but tokens counted for O2/quota), `spent_amount` re-derived, and remaining headroom re-pushed via Realtime (§4.1 budget channel). D4 marks the flushed rows `acked` only on a 2xx.

Device-side audit rows follow the same signed/sequenced envelope to the O1 audit sink (`actor_id` bound server-side).

### 4.5 Rust traits (D4-internal; consumed by D1 shell + D2/D3)

```rust
/// Owns the Realtime subscriptions + snapshot pull + hot-reload.
#[async_trait]
pub trait ConfigSync: Send + Sync {
    /// Cold start: load last-known-good from cache, then attempt a fresh pull.
    async fn bootstrap(&self) -> Result<ConfigSnapshot, SyncError>;
    /// Pull if the server version is newer than `cached`; apply + persist on success.
    async fn sync_now(&self) -> Result<SyncOutcome, SyncError>; // Applied{version} | UpToDate | Offline
    /// Current sync state for the shell.
    fn status(&self) -> SyncStatus;
    /// Subscribe to state transitions (for D1 chips).
    fn subscribe(&self) -> Receiver<SyncStatus>;
}

/// The last-known-good cache (backed by the D1 SQLite store).
#[async_trait]
pub trait OfflineCache: Send + Sync {
    async fn load(&self) -> Result<Option<ConfigSnapshot>, CacheError>;
    async fn store(&self, snap: &ConfigSnapshot) -> Result<(), CacheError>;   // only after a successful apply
    async fn cached_headroom(&self, node: Uuid) -> Result<Option<Headroom>, CacheError>;
}

/// The signed, sequenced, idempotent upload buffer.
#[async_trait]
pub trait UploadBuffer: Send + Sync {
    /// Enqueue a device-side call (local or proxied). Assigns buffer_seq + idempotency_key, signs with the device key.
    async fn enqueue_call(&self, call: DeviceCall) -> Result<BufferSeq, BufferError>;
    async fn enqueue_audit(&self, ev: DeviceAudit) -> Result<BufferSeq, BufferError>;
    /// Flush all pending in seq order to C3/O1; ack on 2xx; stop on first non-idempotent failure.
    async fn flush(&self) -> Result<FlushReport, BufferError>;  // { sent, acked, skipped_duplicates, remaining }
    fn health(&self) -> BufferHealth;   // { queued, oldest_ts, last_flush_ts, flushing }
}

pub enum SyncStatus { Synced { version: i64 }, Syncing, Offline, Degraded, ConfigDrift { cached: i64, server: i64 }, Revoked }
pub enum SyncError { Network, Auth(AuthError), Validation(String), Store(CacheError) }
```

The applied `ConfigSnapshot` is converted to the engine `GatewayConfig` and hot-reloaded via `Gateway::try_update_config(config)` (validated) / `update_config` (D2 owns the engine handle; D4 hands it the new config). A validation failure returns `SyncError::Validation` and the engine keeps running the prior config.

### 4.6 Tauri IPC (desktop shell, D1)

| Command | Returns | Effect |
|---|---|---|
| `sync_status()` | `SyncStatus` | current state for the shell chip |
| `sync_now()` | `SyncOutcome` | force a pull + hot-reload (user "sync now") |
| `buffer_stats()` | `BufferHealth` | queued/oldest/flushing for the "N calls queued" chip |
| `config_version()` | `{ cached, server?, feature_version }` | drift display |
| `flush_now()` | `FlushReport` | force an upload flush |

Events emitted to the shell: `sync:applied{version}`, `sync:offline`, `sync:degraded`, `sync:drift{cached,server}`, `sync:revoked`, `buffer:enqueued{queued}`, `buffer:flushed{acked,remaining}`.

### 4.7 Events (to O1 / Realtime)

- On successful hot-reload: emit a device `config.applied` audit row (`device_id`, `from_version`, `to_version`) via the buffered audit path.
- On repeated snapshot-validation failure or flush failure past a threshold: emit `sync.failed` (audit) + surface `Degraded` to the shell + reflect in `devices.buffer_health`.
- On `devices.status → revoked` (Realtime): tear down, emit `device.revoked_local` audit (buffered until re-auth is impossible → dropped), enter `Revoked`.

---

## 5. Security & RLS

- **Realtime is RLS-scoped by the user JWT (DECISIONS §2 apply-without-asking).** Every channel authorizes with the RS256 Supabase JWT (verified server-side); a device receives only rows its `tenant_id` (and ownership) predicates admit. A leaked or cross-tenant subscribe returns no rows — the same RLS that guards PostgREST guards Realtime. D4 never subscribes to a `service_role` channel.
- **Config is server-authoritative and one-directional.** The device **cannot write config**; the snapshot is read-only and credential-free. There is therefore **no config write path to attack** and **no config merge conflict** — the server's `config_version` always wins on reconnect (§6.4). Privileged writes (chains/budgets/features) happen only via C1 `/rpc/*` from an authorized admin, never from the device.
- **No provider secrets on the device (DECISIONS §2 W4).** `router_credentials`/`tenant_keys` are RLS deny-all to `authenticated` and are never in the snapshot; cloud steps proxy to C1 which decrypts server-side. A stolen device yields no provider keys. The only key on-device is the **Ed25519 device private key in the OS keychain** (F2), used to sign the upload buffer, never transmitted.
- **Upload buffer is signed + idempotent + anti-replay (DECISIONS §2).** Each batch is Ed25519-signed over a canonical payload and verified against the enrolled device pubkey (F2). A monotonic `buffer_seq` rejects replays (`seq ≤ last accepted`); an `idempotency_key` makes re-submits no-ops (anti-double-report). This closes both **anti-forge** (a device can't fabricate someone else's spend — signature + `leaf_node_id` bound to the device's identity) and **anti-under-report** (the server detects sequence gaps and can quarantine; C3 reconciles the rollup against the ledger, C3 flow 10).
- **Revoked device stops spending immediately (DECISIONS §2, F2 §5.7).** The `device:{device_id}` Realtime signal + C1's hot-path device-status check mean a revoked device: (a) is rejected at C1 for any proxied cloud call, and (b) has its buffer flushes rejected (`status != active`). D4 additionally halts the local engine's metered path on the `revoked` signal so an offline revoked device cannot keep accruing local usage it could later try to flush.
- **Tenant isolation.** The snapshot, the cache, and the buffer are all single-tenant (the device's active tenant from the JWT). A tenant switch (F2 §8.5) re-mints the token (bumps `claims_version`), forcing a full re-bootstrap: teardown subscriptions, clear the tenant-scoped cache, re-pull for the new tenant. Buffers are flushed (or held signed) against the tenant they were recorded under.
- **Redaction (DECISIONS §2 W5).** D4 carries **no** prompt/response content in the config snapshot (metadata only) and only tokens/cost/model-name/node-id in the usage buffer — no secret/PII surface. Any device-side audit payload with free text (e.g. a local governance hit reason) passes the C4 redaction pass before it is buffered/uploaded. One-way placeholders in v1.
- **Fail-closed on config, fail-soft on transport.** A snapshot that fails engine validation (`try_update_config`) is rejected and the prior config kept (never partially apply). A network loss degrades to offline/local-plane (fail-soft) — the app keeps working on last-known-good config and last-known headroom, but any cloud step is queued/failed per D3 policy, and a `hard`-capped step with no cached headroom is denied (fail-closed on spend).
- **Negative-test gate.** Extends the F1 RW12 / C1 / C3 harness: a cross-tenant Realtime subscribe delivers 0 rows; a snapshot response never contains a credential/key/token (log + payload scan); a replayed buffer (`seq` reused) and a duplicate `idempotency_key` are no-ops; a revoked device's flush is rejected; a device cannot flush a call attributed to a `leaf_node_id` it doesn't own.

---

## 6. Key flows

**6.1 — Cold start (bootstrap).**
1. Shell boots; D4 `bootstrap()` loads the last-known-good snapshot from `cached_snapshot` and hands D2 a `GatewayConfig` so the local engine is usable **before** any network.
2. D4 attempts `sync_now()`; if online, pull `GET /v1/config/snapshot?since={cached}`; if offline, stay on cache and enter `Offline`.
3. On a successful pull, validate + `try_update_config`, persist as last-known-good, write `devices.config_version` + `last_seen`, enter `Synced{version}`.
4. Open the three Realtime channels (§4.1) with the current JWT.

**6.2 — Live config change (push → pull → hot-reload).**
1. An admin edits config via a C1 `/rpc/*` write; C1's `service_role` write bumps `config.config_versions.version` (+ the touched `components` sub-version).
2. The `tenant:{tenant_id}:config` Realtime channel delivers the change to every subscribed device.
3. D4 debounces (coalesce a burst of edits), then pulls `?since={cached}` → receives a **delta** (only changed components) + the new top `version`.
4. Merge the delta into the cached components, assemble `GatewayConfig`, `try_update_config`. On success: persist, bump `devices.config_version`, emit `sync:applied{version}`, enter `Synced`. On validation failure: keep prior config, emit `sync.failed`, enter `Degraded`, retry with backoff.

**6.3 — Offline operation.**
1. Network drops; the Realtime socket closes; D4 enters `Offline`.
2. The app keeps running on last-known-good config + local models (D2); D3 routes local-capable steps locally and **queues or fails** cloud steps per its policy (D3 open question), using cached headroom for free-floor decisions.
3. Every completed local call is `enqueue_call`'d into the signed `usage_buffer` (`buffer_seq++`, idempotency key, Ed25519 signature); `buffer_health` updates; the shell shows "N calls queued".

**6.4 — Reconnect + reconciliation.**
1. Network resumes; D4 re-auths the Realtime socket (refresh the JWT if near expiry), re-subscribes.
2. **Config:** pull `?since={cached}`. The **server version always wins** — replace/merge to the newer generation (no conflict, config is one-directional). If the server is *older* than cached (impossible in normal flow; only via clock skew), keep cached and log.
3. **Usage buffer:** `flush()` sends pending batches in `seq` order; duplicates (already-acked from a prior partial flush) return 200 no-ops and are marked `acked`; C3 re-derives `spent_amount` and re-pushes headroom via the budget channel.
4. **Self-owned mutations:** replay `pending_mutations` (own `user_preferences`/`conversations`) via PostgREST under RLS, **last-writer-wins by `modified_at`** — if the server row is newer (edited elsewhere), the server value wins and the local mutation is dropped with a `sync:drift` note; otherwise the mutation applies. (These are benign, self-owned, low-contention rows — DECISIONS §2 W1.)
5. **Budget:** adopt the server-pushed headroom as authoritative, discard cached headroom.
6. Enter `Synced`.

**6.5 — Feature-governance change.**
1. An admin changes a 4-state feature (O3) or a member toggles a `user-overridable` feature (self-owned write to `user_preferences`).
2. The server re-resolves precedence, bumps `feature_version` (+ `config_versions`).
3. Realtime notify → D4 pulls the `features` component → caches the new resolved map → the shell re-renders member toggles (some locked) without recomputing precedence on-device.

**6.6 — Device revocation while offline.**
1. An admin revokes the device (F2 `/devices/:id/revoke`).
2. If online: the `device:{device_id}` channel delivers `status=revoked` → D4 tears down, halts the metered local path, enters `Revoked`; the shell shows a hard revoked state.
3. If offline: the device keeps working on local models until it reconnects; on reconnect, the config/device pull returns `revoked` (and C1 rejects any proxied call + any buffer flush — `status != active`), so **no offline-accrued local usage can be flushed** and no cloud spend was ever possible. The revocation is effective the moment the device touches the network.

**6.7 — Buffer flush failure + retry.**
1. A flush gets a 5xx / network error mid-batch. D4 marks only server-acked rows `acked`, leaves the rest `pending`, and schedules an exponential-backoff retry.
2. `buffer_health` (`queued`, `oldest_ts`) is written to `devices.buffer_health` so O3 Device Fleet surfaces backlog; past a threshold D4 emits `sync.failed` and shows `Degraded`.
3. Idempotency guarantees a retried batch never double-reports; sequence guarantees the server can detect a gap.

---

## 7. Gateway-crate dependencies

D4 is primarily Tauri + Supabase + SQLite; its only engine touchpoint is the **config hot-reload** into the embedded local engine (D2's handle). Pin the `sensei-*` crates (local wing + `sensei-gateway`/`sensei-kernel`) at **`v0.4.6`** ([`../plans/gateway-issues.md`](../plans/gateway-issues.md)).

| Issue | What D4 needs | Blocking? |
|---|---|---|
| **GH-1** | Per-step `plane` + execution-location on `ChainEntry`/`Attempt`/`ExecutionTrace`. D4 syncs the `plane` flag on `fallback_chain_models` into the `GatewayConfig` it hot-reloads (so D3 can route per step); the trace's execution-location is what D4 buffers into `inference_calls`. Until GH-1 lands, D4 caches the `plane` at the config-table level but the engine can't carry it per attempt. | **Yes** — before D3 uses synced plane routing (sequenced at the C2/D3 phase). |
| **GH-5** | `inference_calls` shape with org→dept→team→user attribution + `execution_location` + `hold_id`. D4's uploaded device-call records must match this shape so C3 persists them with node attribution. | Decide before D4's buffer→C3 flush (sequenced at F1-rework/C3). |
| `Gateway::update_config` / `try_update_config` | Hot-reload affordance — **present in `v0.4.6`** ([C1 §4.3](../specs/C1-gateway-service.md)); D4 calls `try_update_config` (validated) for a live snapshot swap. No enhancement needed. | No (exists). |
| (GH-2) | OAuth/bearer provider-credential support — **not a D4 concern** (credentials never sync to the device); listed only to note D4 explicitly excludes them from the snapshot. | No. |

No new gateway-repo issue is owned by D4. The hot-reload path uses existing `v0.4.6` API; the plane/attribution fields D4 transports are the GH-1/GH-5 enhancements owned by D3/C3/C1, sequenced before the D4-dependent phases.

---

## 8. Decisions resolved

Settling the D4 seed's residual open questions ("how much to cache; conflict handling on reconnect") per the RESOLVED DEFAULTS.

- **D1 — Config flows one-way (server → device); the device never writes config.** *Rationale:* DECISIONS §2 W1 makes all privileged config writes gateway-mediated via C1 `/rpc/*` from an authorized admin. A device holds a read-only cache, so **reconnect config "conflict" does not exist** — the server `config_version` is always authoritative and simply replaces/merges to the newer generation.
- **D2 — One monotonic per-tenant `config_version` (with a `components` sub-version map), not per-table ETags.** *Rationale:* a device must apply config as a coherent generation (a chain edit + its referenced model land together); a single version gives an atomic reload unit while the `components` map enables delta pulls. New F1 delta `config.config_versions` (§3.1).
- **D3 — Snapshot is pulled versioned + credential-free; hot-reloaded via `try_update_config`.** *Rationale:* validated atomic swap keeps the engine on last-known-good if the new snapshot is invalid (fail-closed on config); credentials are excluded by construction (DECISIONS §2 W4).
- **D4 — Feature-state precedence is resolved server-side (O3); D4 syncs the flat resolved map + a `feature_version`.** *Rationale:* a device must never compute an authoritative governance decision (DECISIONS §4); resolving centrally keeps the four-layer precedence single-sourced and lets a governance change propagate by Realtime like any config change.
- **D5 — What to cache: the full tenant config snapshot + resolved features + last-known budget headroom (leaf+ancestors) + the local RAG index; NOT credentials, NOT other users' data, NOT the full ledger.** *Rationale:* enough to run the local plane fully offline (local models + config + free-floor headroom + RAG) without ever caching a secret or another tenant's/user's data. Budget headroom is cached **advisory** — server re-pushes authoritative values on reconnect.
- **D6 — Usage/audit upload buffer is Ed25519-signed + monotonic-sequenced + idempotent; flushed to C3 `/v1/usage/report` and the O1 audit sink.** *Rationale:* DECISIONS §2 (offline buffers signed + idempotent, anti-replay/anti-under-report); the device key never leaves the OS keychain; C3 verifies + reconciles.
- **D7 — Reconnect conflict policy: config = server-wins (one-directional, no conflict); usage buffer = additive + idempotent (no conflict — replays are no-ops); self-owned benign writes = queued optimistic mutations replayed last-writer-wins by `modified_at`, RLS-arbitrated.** *Rationale:* the only device-originated writes are additive (usage) or self-owned low-contention rows (preferences/own conversations), so LWW is sufficient and no CRDT/merge machinery is warranted for v1.
- **D8 — Fail-closed on config, fail-soft on transport.** *Rationale:* a bad snapshot must not brick the engine (keep last-known-good); a network loss must not block the app (degrade to local plane), but a `hard`-capped cloud step with no cached headroom is denied rather than admitted with an implicit budget.
- **D9 — Revoked device halts the local metered path on the `revoked` signal, and any offline-accrued usage is unflushable (C3 rejects `status != active`).** *Rationale:* DECISIONS §2 — a revoked device cannot keep spending, on either plane; effective the moment it touches the network.
- **D10 — Config change propagation is Realtime-push + debounced pull, with a periodic reconcile poll as a fallback.** *Rationale:* Realtime is the primary path (near-real-time); a low-frequency `config_version` poll (and pull-on-focus/resume) covers a dropped Realtime channel without hammering the server. Mirrors F2's device-status cache fallback (F2 §10.3).

---

## 9. Acceptance criteria (observable, testable)

1. **Cold-start offline:** with no network, the app boots, loads last-known-good config from the SQLite cache, and the local engine answers a local chat — no central call is made.
2. **Push → hot-reload:** an admin `/rpc/chains/*` edit bumps `config_versions.version`; a subscribed device receives the Realtime notify, pulls a **delta**, and a subsequent local/proxied request uses the new chain **without an app restart**; `devices.config_version` reflects the new version.
3. **Coherent atomic apply:** an edit that changes a chain and the model it references is applied together (never a state where the chain references a not-yet-synced model); a snapshot that fails `try_update_config` leaves the engine on the prior config (observable: engine still answers with the old chain, `sync.failed` audit row emitted).
4. **Credential exclusion:** the `GET /v1/config/snapshot` response contains no `router_credentials`/key/token field (payload scan test); a cloud step in the synced chain executes only by proxying to C1 (no local credential present).
5. **Realtime RLS scope:** a device authed for tenant A subscribing to the config channel receives 0 rows for tenant B; a cross-tenant subscribe attempt yields nothing (RW12-style negative test).
6. **Signed buffer round-trip:** an offline local call is enqueued with a monotonic `buffer_seq`, an idempotency key, and an Ed25519 signature; on reconnect `flush()` posts it to `/v1/usage/report`; it appears **exactly once** in `inference_calls` (`execution_location='local'`) and the member's remaining headroom updates via Realtime.
7. **Anti-replay / idempotency:** re-submitting a batch with a reused `buffer_seq` is rejected; re-submitting a duplicate `idempotency_key` returns a 200 no-op and creates no second ledger row.
8. **Revoked device:** after revocation, (a) the online device enters `Revoked` on the `device` channel within the F2 cache TTL, (b) an offline device's queued usage is rejected on reconnect (`status != active`), and (c) no cloud call succeeds — the device cannot spend on either plane.
9. **Reconnect config-wins:** a device whose cached `config_version` is stale pulls and adopts the newer server generation on reconnect; cached budget headroom is replaced by the server-pushed authoritative value.
10. **Self-owned mutation replay:** a preference toggled offline is replayed on reconnect and persists; if the same preference was changed elsewhere with a newer `modified_at`, the server value wins and a `sync:drift` note is surfaced.
11. **Feature governance sync:** an admin flipping a feature to `locked` propagates via Realtime; the member's toggle renders locked after the pull, and the device did not recompute precedence locally (it consumed the resolved map).
12. **Buffer health surfaced:** with N queued calls and a failing flush endpoint, `buffer_stats()` reports `queued=N` with an `oldest_ts`, `devices.buffer_health` reflects it for O3 Device Fleet, and retries eventually drain the buffer once the endpoint recovers (with no double-reporting).
13. **Sync chips:** the D1 shell shows `synced · config vNNN`, `syncing`, `offline`, and `N calls queued` states matching the `SyncStatus`/`BufferHealth` from IPC (mockup-review cross-cutting item + item 39).

---

## 10. Open questions

1. **Delta retention horizon.** How many past `config_version` generations the server retains for delta pulls before forcing a full snapshot (memory/latency trade-off) — pending load characteristics; D4 tolerates either (full pull is always valid). Not a build blocker.
2. **Realtime fan-out at fleet scale.** Whether a per-device config channel scales, or whether a shared per-tenant channel + client-side filtering is cheaper when a tenant has many devices — coordinate with the C1/O3 deploy topology (mirrors F2 §10.3). Default: per-tenant config + budget channels, per-device only for the device-status channel.
3. **Buffer size cap + eviction.** The max on-device buffer size before back-pressure (e.g. warn the user / block new metered local calls) if a device is offline for a very long time and the buffer grows unbounded — v1 default: soft-warn at a threshold, never silently drop (dropping would under-report). Threshold value TBD from telemetry.
4. **Snapshot pull authority split.** Whether `GET /v1/config/snapshot` is a dedicated C1 handler or the device assembles the snapshot from RLS-scoped PostgREST SELECTs with a `config_versions` read for the atomic version. Default: C1 endpoint (guarantees one atomic generation); the PostgREST path is a fallback. Confirm at the C1 build phase.
</content>
</invoke>
