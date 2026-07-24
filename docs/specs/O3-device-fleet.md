# O3 · Device fleet & feature governance — Spec

**Module:** [O3](../modules/O3-device-fleet.md) · **Status:** Planned (build-ready) · **Plane:** Ops
**Depends on:** [F1](F1-data-model.md) (schema: `devices`, `config.modules`/`features`/`feature_states`, `user_preferences`), [F2](F2-identity-auth-rbac.md) (device lifecycle + `DeviceGuard` hot-path gate + `feature.manage`/`device.manage` capabilities), [D4](../modules/D4-config-sync.md) (config-version pull + Realtime + offline buffers) · via [C1](C1-gateway-service.md) (`/rpc/governance/set-feature`, `/v1/devices/*` domain RPCs, hot-path device check)
**Enables:** W1 (Device fleet + Feature management admin screens), W2/D1 (which member toggles render, and render **locked**), D4 (feature-state version in the config snapshot), O1 (device/feature audit events)
**Date:** 2026-07-23 · **Authority:** [`../DECISIONS.md`](../DECISIONS.md) §4 (4-state governance + `workspace→space→role→user` precedence), §2 (device-status hot-path check, `feature_states` `tenant_id`+RLS + revoke anon writes, signed/idempotent offline buffers). Where anything here disagrees with `DECISIONS.md`, that record wins.

---

> **This spec OWNS the feature-governance model** — the `config.modules`/`config.features` **registry** (the config catalog of what is governable), the reworked `config.feature_states` **4-state governance policy** table, the `app.user_preferences` user layer, and the **precedence-resolution algorithm** (`workspace→space→role→user`) that every client render and every server-side gate reads. It does **not** own device *authentication/enrollment* (F2) or *config transport* (D4); it owns the **device-fleet read/admin surface** (list, health, revoke-action orchestration, per-device sync policy) layered on F2's `devices` table, and it fixes the **per-request device-status-check latency budget** on the C1 hot path.

---

## 1. Purpose & scope

O3 is the **admin/ops side of the split-plane**. It answers two operator questions:

1. **"Which devices are enrolled, healthy, and allowed to spend?"** — a fleet view over F2's `devices` table: `last_seen`, app/config version, offline-buffer health, per-device sync policy, and a **revoke** action that (via F2's `DeviceGuard`) cuts a device's hot-path access even while its JWT is still valid.
2. **"Which features does each member see, and can they change them?"** — a **4-state feature-governance matrix** (`locked` / `default-on` / `default-off` / `user-overridable`) resolved with precedence **workspace → space → role → user**, driving which member toggles render and which render locked.

**In scope:**
- The **modules/features registry** (`config.modules`, `config.features`) — the catalog that declares *what* is governable, its default state, and whether it is mandatory/user-facing.
- The reworked **`config.feature_states`** as the tenant-scoped **4-state governance policy** (per feature × scope), with anon writes revoked and RLS added (F1 RW6).
- **`app.user_preferences`** — the user layer of the control model (F1 RW6).
- The **effective-state resolver** (`config.resolve_feature_state(…)`) that both Postgres RLS/PostgREST reads and C1/clients call, and its inclusion in the D4 config snapshot (as a `feature_states` version).
- The **feature-governance write RPC** (`POST /rpc/governance/set-feature`, C1-mediated, capability `feature.manage`).
- The **device-fleet read model + admin actions**: list/detail, buffer-health rendering, per-device sync-policy edit, and orchestrating F2's `/v1/devices/:id/revoke`.
- **Workspace-default seeding on tenant creation** (which governance rows exist for a fresh tenant).
- The **per-request device-status-check latency budget** contract on the C1 hot path (F2 implements the gate; O3 fixes its budget + observability).

**Out of scope (owned elsewhere, consumed here):**
- Device **enrollment / keypair / `device_id` claim / `DeviceGuard::check`** semantics and the `/v1/devices/enroll|revoke` endpoints — **F2** (§4.6, §5.7, §6.2).
- **Config transport** — Realtime channels, the versioned pull, `Gateway::update_config` hot-reload, and the signed/idempotent offline usage/audit buffers — **D4**. O3 defines the *health signal shape* D4 populates and *reads it back*.
- The **DDL** for `devices`, `config.modules/features/feature_states`, `user_preferences` — **F1** (RW6, RW10). O3 specifies their shape, invariants, and policies; F1 emits DDL.
- The **admin UI** itself (Device fleet, Feature management screens) — **W1**.
- The **audit ledger** persistence — **O1** (O3 emits events to it).

---

## 2. Responsibilities

1. Own the **feature-governance data model**: the registry (`modules`/`features`), the 4-state governance policy (`feature_states`), and the user layer (`user_preferences`) — their shape, invariants, and RLS.
2. Own and publish the **precedence-resolution algorithm** and its canonical implementation `config.resolve_feature_state(...)` (a `SECURITY DEFINER` SQL function) so clients (render) and C1 (enforce) agree on one truth.
3. Provide the **feature-governance admin contract** (`/rpc/governance/set-feature`) — capability-gated, tenant-scoped, audit-emitting, config-version-bumping.
4. **Seed workspace-scope governance defaults on tenant creation** (from the platform feature catalog), so a fresh tenant has no undefined feature states.
5. Provide the **device-fleet read model + admin actions**: enumerate devices with `last_seen`/versions/buffer-health/sync-policy; orchestrate revoke via F2; edit per-device sync policy.
6. Define the **offline-buffer-health signal shape** (`devices.buffer_health jsonb`) that D4 writes on heartbeat and O3 renders (queued/flushing/stale/failed).
7. Fix the **per-request device-status-check latency budget** on the C1 hot path and its observability (a revoked device cannot keep spending; the check adds negligible latency).
8. Emit **feature-governance and device-fleet audit events** to O1 (`feature.governance_set`, `device.sync_policy_changed`; device enroll/revoke are F2-emitted).
9. Ensure a governance change **propagates**: bump the tenant `config_version` so D4 pushes the new `feature_states` snapshot to devices, and Realtime-invalidate the client render.

---

## 3. Data model (F1 tables owned / used)

All tables are created/altered by the **F1 rework** ([`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md), features **RW6** feature-governance + **RW10** device fix). O3 specifies **shape, invariants, and policies**; F1 emits the DDL.

### 3.1 Owned — feature governance (RW6)

**`config.modules`** *(registry — the config catalog of governable groupings)*

| Column | Notes |
|--------|-------|
| `id uuid pk` | |
| `slug text unique` | URL/identifier segment (built column kept) |
| `name`, `title`, `description` | display |
| `sequence int`, `is_active bool` | ordering + retire |
| `modified_at/by` | |

Platform-owned catalog (no `tenant_id` — the *set* of modules/features is shared; per-tenant governance lives in `feature_states`). Readable under RLS by `authenticated`.

**`config.features`** *(registry — the settable governance unit)*

| Column | Notes |
|--------|-------|
| `id uuid pk`, `module_id uuid fk→modules` | |
| `slug text` (`unique(module_id, slug)`) | stable governance key (e.g. `playground.rerank`, `ask.auto_tune`) |
| `title`, `description`, `purpose` | display |
| **`governable bool default true`** | *new* — false ⇒ never appears in the governance matrix (structural, not a toggle) |
| **`user_facing bool default true`** | *new* — whether a member toggle can render at all |
| **`default_state text`** | *new* — catalog default `∈ {default_on, default_off, user_overridable}` used to seed workspace rows + as the terminal fallback |
| `mandatory bool default false` | mandatory ⇒ effectively `locked` on, admin cannot expose a toggle |
| `sequence int`, `enabled bool` | |
| `modified_at/by` | |

**`config.feature_states`** *(REWORKED → the 4-state governance policy — F1 RW6 + DECISIONS §2)*

The built table was a per-user boolean override. It is **repurposed** into the tenant-scoped governance policy; the user layer moves to `user_preferences`.

| Column | Notes |
|--------|-------|
| `id uuid pk` | |
| **`tenant_id uuid not null`** | *new* — RLS key (DECISIONS §2 apply-without-asking) |
| `feature_id uuid fk→config.features` | |
| **`scope_type text not null`** | `∈ {workspace, space, role}` — the governance layer |
| **`scope_id uuid null`** | `null` when `scope_type='workspace'`; `space_id` when `space`; `role_id` when `role` |
| **`state text not null`** | `∈ {locked, default_on, default_off, user_overridable}` (the ratified 4-state) |
| **`value boolean`** | the on/off carried by `locked` (pinned value) and `user_overridable` (the default before a user pref). For `default_on`/`default_off` it is derived (`true`/`false`) and ignored on write. |
| `version bigint not null default 0` | bumped by the historize trigger (kept); feeds the D4 `feature_states` snapshot version |
| `modified_at/by` | |

`unique(tenant_id, feature_id, scope_type, scope_id)` — one governance row per feature per scope instance. Composite FK `(tenant_id, scope_id)` to `spaces`/`roles` where applicable (in-tenant integrity).

**`app.user_preferences`** *(the user layer — F1 RW6)*

| Column | Notes |
|--------|-------|
| `tenant_id uuid`, `profile_id uuid` | |
| `feature_id uuid fk→config.features` *(or `key text`)* | keyed to a feature for governed toggles; free-form `key`/`value jsonb` for non-governed prefs (theme, citation density) |
| `value boolean` | the user's chosen state (governed toggles) |
| `modified_at` | |
| `pk(tenant_id, profile_id, feature_id)` | |

`user_preferences` is a **self-owned benign write** (§2 W1): the owner may INSERT/UPDATE their own rows; it is *advisory* — the resolver ignores it unless the effective governance mode is `user_overridable`.

### 3.2 Used — device fleet (F2-owned shape; F1 RW10 adds health)

**`public.devices`** *(owned by F2 §3.1; F1 built it, RW10 adds `buffer_health`)*

| Column | Notes |
|--------|-------|
| `tenant_id uuid`, `id uuid` (`pk(tenant_id, id)`) | |
| `profile_id uuid` | owning user |
| `name`, `platform`, `public_key text` | enrollment (F2 §6.2) |
| `app_version`, `config_version bigint` | last synced config (D4) |
| `status text` `∈ {active, revoked}` | hot-path gate reads this (F2 §5.7) |
| `enrolled_at`, `last_seen_at timestamptz` | heartbeat |
| **`buffer_health jsonb`** | *new (RW10)* — offline-buffer health signal, shape §3.3 |
| **`sync_policy jsonb`** | *new (O3)* — per-device sync policy, shape §3.4 |

O3 **reads** `devices` for the fleet view and **writes** `sync_policy` via `/rpc/devices/set-sync-policy` (capability `device.manage`); `status` is written only by F2's `/v1/devices/:id/revoke`. `public_key`/keypair material is never surfaced to the fleet UI.

### 3.3 `devices.buffer_health` jsonb shape (D4 writes on heartbeat; O3 renders)

```jsonc
{
  "usage_queued":   3,          // call records buffered, not yet flushed to inference_calls
  "audit_queued":   0,          // audit rows buffered
  "last_flush_at":  "2026-07-23T10:15:00Z",
  "oldest_pending_at": "2026-07-23T10:02:00Z",
  "flush_status":  "ok",        // ok | flushing | retrying | failed
  "clock_skew_ms": 120          // device vs server clock delta (anti-replay signal)
}
```
Health verdict (rendered): **healthy** (`usage_queued+audit_queued` small, `flush_status=ok`), **flushing**, **stale** (`oldest_pending_at` older than the D4 threshold), **failed** (`flush_status=failed`). The buffer itself is signed + idempotent (D4 / DECISIONS §2) — O3 only reports its health, never accepts unsigned counts as spend.

### 3.4 `devices.sync_policy` jsonb shape (O3 owns)

```jsonc
{
  "config_pull": "realtime",    // realtime | interval | manual
  "pull_interval_s": 300,        // when config_pull=interval
  "offline_grace_h": 72,         // how long the device may run on cached config before forced re-sync
  "buffer_flush": "on_reconnect" // on_reconnect | interval
}
```
Defaults are seeded per tenant; an operator with `device.manage` edits per device. D4 reads `sync_policy` to schedule pulls/flushes.

---

## 4. Contracts

### 4.1 Precedence-resolution algorithm (AUTHORITATIVE — O3 owns)

Given a feature, the caller's `space_id?`, `role_ids[]`, and `profile_id`, the **effective state** is resolved as follows. This is the single algorithm both the client (to render) and C1 (to enforce) use; drift is a bug.

Inputs: the governance rows for the feature at `workspace` (scope_id null), the active `space` (if any), and each of the caller's `role`s; plus the caller's `user_preferences` row; plus `features.default_state`/`mandatory`.

Resolution order (`workspace → space → role → user`):

1. **Mandatory floor.** If `features.mandatory` → return `{enabled: true, governed: true, source: 'mandatory'}`. (Cannot be exposed or overridden.)
2. **Locks cascade broadest-wins.** Among rows with `state='locked'`, the **broadest** scope wins (`workspace` beats `space` beats `role`) — a space owner cannot loosen an admin lock, a role cannot loosen a space lock. If any lock applies → return `{enabled: row.value, governed: true, source: 'locked@'+scope}`.
3. **Non-locked, most-specific-wins.** With no applicable lock, take the **most specific** present row (`role` beats `space` beats `workspace`) as the effective *mode*:
   - `default_on` → base value `true`; `default_off` → base value `false`; `user_overridable` → base value `row.value`.
   - If no row at any scope → fall back to `features.default_state` (base value derived likewise).
4. **User layer.** If the effective mode is `user_overridable` **and** a `user_preferences` row exists for `(feature, profile)` → return `{enabled: pref.value, governed: false, source: 'user'}`. Otherwise return `{enabled: base_value, governed: (mode != user_overridable), source: <scope-or-default>}`.

`governed=true` ⇒ the client renders the toggle **locked** (greyed + lock + tooltip naming the source scope); `governed=false` ⇒ the member may toggle it (writes `user_preferences`).

> **Rationale for the asymmetry** (locks broadest-wins vs. non-locks most-specific-wins): a `locked` is an *authority* statement (the higher the scope, the more authoritative — an admin lock is final); a non-locked default is a *refinement* statement (the closer to the user, the more context-appropriate — a role default refines a space default refines the workspace default). Settled in §8.

### 4.2 Canonical resolver — `config.resolve_feature_state(...)`

```sql
-- SECURITY DEFINER, STABLE, search_path pinned; EXECUTE granted to authenticated.
-- Reads feature_states (service_role-write-only, not directly SELECTable by clients — §5.3),
-- resolves the §4.1 algorithm on the caller's behalf, returns only the verdict (no policy rows leak).
create function config.resolve_feature_state(
  p_feature_slug text,
  p_space_id     uuid default null
) returns table (enabled boolean, governed boolean, source text)
  security definer set search_path = config, app, core, public
  language plpgsql stable as $$ /* uses auth.jwt() tenant_id, core.jwt_role_ids(), auth.uid() */ $$;

-- Bulk variant for the member client's initial render (all user-facing features for a space):
create function config.resolve_feature_states(p_space_id uuid default null)
  returns table (feature_slug text, enabled boolean, governed boolean, source text) ...;
```

- Uses F2's `core.jwt_role_ids()` and `auth.jwt()->>'tenant_id'` — no client-supplied identity is trusted.
- `SECURITY DEFINER` because `feature_states` is `service_role`-write-only and not directly `SELECT`able by `authenticated` (§5.3); the function returns only the boolean verdict, so no governance policy rows leak.
- **C1 mirrors the same algorithm in Rust** (fed by the config snapshot it already loads) so the gateway and Postgres agree; C1 passes the resolved governance context to C4 for enforcement of governed runtime features (e.g. `grounded-only`, masking).

### 4.3 HTTP — feature-governance write (C1 `/rpc/*`, gateway-mediated)

Privileged writes flow through C1 per the RESOLVED default; O3 owns the governance-feature slice of `/rpc/governance/*` (schema-aligned with C1 §4.2).

| Method + path | Capability | Body / effect |
|---------------|-----------|---------------|
| `POST /rpc/governance/set-feature` | `feature.manage` | `{feature_slug, scope_type, scope_id?, state, value?}` → upsert one `config.feature_states` row; bump tenant `config_version`; emit `feature.governance_set`. Rejects `scope_id` mismatched to `scope_type`, `state` outside the 4 values, and (subset guard) a space-scope caller who lacks `space.manage` on that space. |
| `POST /rpc/governance/clear-feature` | `feature.manage` | `{feature_slug, scope_type, scope_id?}` → delete the row (reverts to the next-broader scope / catalog default). |
| `POST /rpc/devices/set-sync-policy` | `device.manage` | `{device_id, sync_policy}` → write `devices.sync_policy`; emit `device.sync_policy_changed`. |

Device enroll/list/revoke are **F2's** endpoints (`/v1/devices/enroll`, `GET /v1/devices`, `POST /v1/devices/:id/revoke`) — the O3 Device-fleet screen consumes them; O3 adds no parallel device-write path.

### 4.4 Reads (PostgREST under RLS + resolver)

- **Feature registry:** `GET config.modules`, `GET config.features` (tenant `authenticated` `SELECT`) — powers the Feature-management matrix rows.
- **Effective states:** clients call `config.resolve_feature_states(space_id)` (RPC) for their render — never read `feature_states` directly.
- **Governance matrix (admin):** the Feature-management screen needs the raw policy rows to show what is set where. Because `feature_states` is not client-`SELECT`able (§5.3), C1 exposes `GET /rpc/governance/matrix?space_id=` (capability `feature.manage`) returning the per-scope rows for the tenant. *(Reads through C1 so the same capability gate applies; alternatively a `feature.manage`-scoped RLS SELECT policy — decided §8.4.)*
- **Device fleet:** `GET public.devices` (tenant `authenticated` `SELECT`, RLS narrows to own devices unless caller has `device.manage` — F2 §5.5), plus `buffer_health`/`sync_policy`.

### 4.5 Config-snapshot contribution (to D4)

D4's versioned config pull carries a `feature_states` block so a device can resolve governance offline. O3 defines its shape:

```jsonc
"feature_governance": {
  "version": 412,                     // = max(feature_states.version) for the tenant; drives config_version
  "features": [ { "slug": "playground.rerank", "module": "playground",
                  "mandatory": false, "user_facing": true, "default_state": "user_overridable" } ],
  "policies": [ { "feature": "playground.rerank", "scope_type": "space",
                  "scope_id": "…", "state": "locked", "value": false } ]
}
```
The device runs the **same §4.1 algorithm** locally against the cached snapshot + its local `user_preferences`, so offline renders match online. A governance write bumps `version` → D4 Realtime-pushes → device re-resolves.

### 4.6 Rust — device-status hot-path budget (O3 fixes; F2 `DeviceGuard` implements)

O3 does not define a new trait; it constrains F2's `DeviceGuard::check` (C1 §4.4 middleware order):

```
budget: on a warm cache hit, DeviceGuard::check adds < 1 ms p99 to the request and performs
        ZERO synchronous DB round-trips on the hot path;
freshness: a revoke propagates within <= 30 s (cache TTL) or immediately on the Supabase Realtime
        signal on `devices` (whichever first) — see F2 §5.7 / C1 D6.
```
See §6.8 for the observable budget.

### 4.7 Events (to O1 `audit_events`, actor-bound)

| Event | Emitted by | When |
|-------|-----------|------|
| `feature.governance_set` | C1 (`/rpc/governance/set-feature`) | a governance row upsert/clear; payload = `{feature_slug, scope_type, scope_id, state, value}` |
| `device.sync_policy_changed` | C1 (`/rpc/devices/set-sync-policy`) | sync-policy edit |
| `device.enrolled`, `device.revoked` | **F2** (§4.6) | O3 consumes/renders; does not re-emit |

All actor-bound (`actor_id = auth.uid()`); UPDATE/DELETE on the ledger denied (O1). Device `public_key` and any token material never appear in payloads.

---

## 5. Security & RLS

### 5.1 Capabilities (from F2 §4.3 — O3 defines no new ones)
- `feature.manage` — set 4-state governance (workspace/space/role scope). Space-scope writes additionally require `space.manage` on the target space (subset guard, §4.3).
- `device.manage` — list/revoke **other** users' devices, edit sync policy. Self-service (list/revoke **own** device) needs no capability (F2).
- Editing **own** `user_preferences` needs **no capability** — a self-owned benign write (§2 W1 / F2 §4.3 note 2).

### 5.2 Tenant isolation
Every O3 table is tenant-scoped by RLS: `tenant_id = (auth.jwt()->>'tenant_id')::uuid`. `config.modules`/`config.features` are the shared catalog (no `tenant_id`, `SELECT`-only for `authenticated`); all *governance* (`feature_states`) and *user* (`user_preferences`) rows are tenant-scoped. A cross-tenant read returns 0 rows. `devices` isolation is F2's (own-vs-`device.manage`).

### 5.3 Gateway-mediated writes + anon lockdown (DECISIONS §2 W1 + apply-without-asking)
- `config.feature_states` becomes **`service_role`-write-only**: `authenticated`/`anon` `INSERT/UPDATE/DELETE` are `REVOKE`d (the built schema's **anon-writable `feature_states` hole is closed** — F1 RW6). All governance writes flow through `/rpc/governance/set-feature`, which `require(ctx, feature.manage)` server-side. It is also **not directly `SELECT`able** by `authenticated` (reads go through the resolver §4.2 or the capability-gated matrix RPC §4.4) so raw policy across scopes doesn't leak to members.
- `app.user_preferences` is **owner-write** (`tenant_id` + `profile_id = auth.uid()`), owner-read; it is the one client-writable O3 table.
- `devices.status` is written only by F2's revoke RPC; `devices.sync_policy` only by O3's `device.manage` RPC. Members get tenant-scoped `SELECT` on their own device rows.

### 5.4 Device revocation cuts the hot path (DECISIONS §2 apply-without-asking)
The O3 fleet **revoke** action calls F2's `POST /v1/devices/:id/revoke` → `devices.status='revoked'`. On the next C1 inference request bearing that `device_id`, F2's `DeviceGuard::check` (run **before** the budget reserve — C1 §6.1 step 3) returns `DeviceRevoked` → `403`, so a revoked device **cannot keep spending** even with an unexpired JWT. Propagation ≤ 30 s / immediate on the Realtime signal (§4.6).

### 5.5 Secrets & redaction
O3 handles **no** provider secrets and **no** device private keys (they never leave the client keychain — F2). The fleet view exposes device metadata only (never `public_key` raw, never any token). Governance rows are booleans/enums — no PII. Any free-form `user_preferences.value` and audit payloads pass the W5 redaction check before persistence where applicable (they should never contain secrets by construction).

### 5.6 No governance bypass invariant
Because C1 resolves governed *runtime* features server-side via the same §4.1 algorithm (not from the client), a member who forges a `user_preferences` value or hand-crafts a request **cannot** enable a feature the governance denies: a `locked`/non-`user_overridable` feature ignores the user layer entirely (§4.1 steps 2–4). The client toggle render is a UX convenience; enforcement is server-side (RW12 negative test, §9).

---

## 6. Key flows (numbered)

**6.1 — Workspace defaults seeded on tenant creation.**
1. On tenant creation (F1 RW11 seed / the tenant-provision path), for every `config.features` row with `governable=true`, insert a `feature_states(tenant_id, feature_id, scope_type='workspace', scope_id=null, state=features.default_state)` row.
2. `mandatory` features get **no** governance row (the resolver's mandatory floor §4.1.1 handles them).
3. Result: a fresh tenant has a fully-defined workspace layer — no undefined/empty governance states on first admin visit. (Seeding is idempotent; re-running `dbd import` re-yields the same rows.)

**6.2 — Admin sets a workspace-level 4-state.**
1. Admin (holding `feature.manage`) toggles a feature to e.g. `locked`/off in the Feature-management matrix (W1).
2. Client → `POST /rpc/governance/set-feature {feature_slug, scope_type:'workspace', state:'locked', value:false}`.
3. C1: `require(ctx, feature.manage)` → upsert the `feature_states` row (`service_role`) → bump tenant `config_version` → emit `feature.governance_set`.
4. Realtime invalidates member renders; D4 pushes the new snapshot (§4.5) to enrolled devices.

**6.3 — Space owner overrides within the workspace.**
1. Space owner (holding `space.manage` on that space + `feature.manage`) sets a space-scope state for the feature.
2. C1 applies the subset guard (§4.3): a space-scope write requires `space.manage` on `scope_id`.
3. Resolution (§4.1): the space row now wins for members in that space — **unless** the workspace row is `locked` (broadest lock wins → the space override is rejected at write time with `409 locked_by_workspace`, or accepted-but-inert; **rejected at write** is chosen §8.5 so the UI never shows an override that does nothing).

**6.4 — Role narrows inside the space.** A role-scope row refines further (most-specific-wins among non-locked, §4.1 step 3): members holding that role in that space see the role value; others see the space/workspace value.

**6.5 — Member render + user override.**
1. Member client calls `config.resolve_feature_states(space_id)` on load → one verdict per user-facing feature (`enabled`, `governed`, `source`).
2. Governed toggles render **locked** (greyed + lock + tooltip = `source`); `user_overridable` toggles render active.
3. Member flips a `user_overridable` toggle → upsert own `app.user_preferences` row (self-owned write, no capability). Next resolve returns the user value (§4.1 step 4).

**6.6 — Server-side enforcement of a governed runtime feature.** On `/v1/chat` with `space_id`, C1 resolves the governance context (same algorithm) and passes it to C4; e.g. if `grounded-only` is `locked` on, C4 enforces it regardless of any client toggle or `user_preferences` value (§5.6).

**6.7 — Device fleet: enroll → heartbeat → render.**
1. Desktop enrolls via F2 (`/v1/devices/enroll`) → a `devices` row appears in the fleet.
2. On each sync/flush, D4 updates `last_seen_at`, `app_version`, `config_version`, and `buffer_health` (§3.3).
3. The O3 Device-fleet screen lists devices with a health verdict (healthy/flushing/stale/failed), version drift (device `config_version` vs tenant current), and per-device `sync_policy`.

**6.8 — Revoke device → hot-path cut (with latency budget).**
1. Admin clicks **Revoke** → C1 → F2 `/v1/devices/:id/revoke` → `status='revoked'` + Realtime signal.
2. Every subsequent C1 inference request runs `DeviceGuard::check` **before** the budget reserve.
3. On a warm cache hit the check adds `< 1 ms` p99 and does **no** synchronous DB round-trip (§4.6); the revoked device is rejected `403 device_revoked` within ≤ 30 s / immediately on the Realtime signal.

**6.9 — Sync-policy change.** Admin (`device.manage`) edits a device's `sync_policy` → `/rpc/devices/set-sync-policy` → D4 picks up the new pull/flush schedule on its next cycle; `device.sync_policy_changed` audited.

---

## 7. Gateway-crate dependencies (+ GH-issue refs)

O3 adds **no** engine capability and owns **no blocking gateway issue** — it is Postgres + C1-RPC + D4-transport.

- **No blocking GH issue.** The device-status gate (F2 `DeviceGuard`) runs in C1 middleware **before** the crate's budget filter / `execute` call (C1 §6.1) — no crate change (F2 §7).
- **Adjacent (not owned by O3):** a feature-governance write bumps `config_version`, which D4 applies via `Gateway::update_config` / `try_update_config` (D4 seed) — O3 only produces the `feature_states` snapshot block (§4.5); the hot-reload mechanism is D4's. No new crate affordance is required for feature governance (it is enforced consumer-side in C1/C4, not in the engine).
- **Trace/exec-location (GH-1, referenced only):** the plane/execution-location fields ([`../plans/gateway-issues.md`](../plans/gateway-issues.md) GH-1) power the *device* exec-location badge in W2/W1 but are consumed by O1/O2/D3 — O3 renders the fleet, not the per-call trace, so GH-1 is not an O3 dependency.

---

## 8. Decisions resolved

Settling the O3 seed's residual questions per the RESOLVED DEFAULTS.

1. **Governance granularity = per-FEATURE; module is a grouping.** The settable unit is a `config.features` row; `config.modules` groups features for the matrix UI and bulk-set convenience. *Rationale:* the old `UiFeature`/`UiFeatureState` model is feature-grained, the mockups toggle features, and per-module-only would be too coarse for controls like `playground.rerank` vs `playground.hybrid`. A module-level "set all" is UX sugar that writes N feature rows, not a distinct governance level. Resolves the seed's "per-feature vs per-module" question.
2. **Workspace defaults seed at tenant creation from the catalog `default_state`.** Every `governable` feature gets a `scope_type='workspace'` row seeded from `features.default_state` (§6.1), idempotently, in the F1 RW11 seed. *Rationale:* guarantees no undefined states on first admin visit and makes the workspace layer explicit/auditable rather than an implicit fallback. `mandatory` features are handled by the resolver floor, not a row. Resolves the seed's "how workspace defaults seed" question.
3. **`feature_states` is repurposed into the 4-state governance policy; the user layer is `user_preferences`.** The built per-user-boolean `feature_states` becomes `(tenant, feature, scope_type, scope_id, state, value)`; per-user choices move to `user_preferences`. *Rationale:* DECISIONS §4 gives `feature_states` `tenant_id` + role/space scope + 4-state and adds `user_preferences` for the user layer — the two roles cannot coexist in one table.
4. **The admin governance matrix is read via a capability-gated C1 RPC (`GET /rpc/governance/matrix`), not a client RLS SELECT on `feature_states`.** *Rationale:* keeps `feature_states` fully `service_role`-only (one custody story, no "which scopes are readable" RLS subtlety), and the same `feature.manage` gate covers both read and write of raw policy. Members never need raw rows (they use the resolver verdict). *(If a direct `feature.manage`-scoped SELECT policy is later preferred for latency, it is a compatible addition.)*
5. **A broader-scope `locked` rejects a narrower override at write time** (`409 locked_by_workspace`), rather than silently accepting an inert row. *Rationale:* the matrix UI must never show an override that does nothing; failing the write keeps the stored policy honest and the UI truthful.
6. **Locks resolve broadest-wins; non-locked defaults resolve most-specific-wins** (§4.1). *Rationale:* a lock is an authority statement (admin > space owner > role), a default is a contextual refinement (role > space > workspace); this is the only reading of `workspace→space→role→user` that lets an admin lock be final while still letting a role refine an unlocked default. Chosen and frozen.
7. **Device-status hot-path budget = `< 1 ms` p99 added latency on a warm cache hit, zero synchronous hot-path DB round-trips, revocation effective ≤ 30 s / immediate on Realtime** (§4.6). *Rationale:* DECISIONS §2 requires the check on the hot path but it must not tax every inference call; F2's cache + Realtime model (C1 D6) meets it. O3 fixes the number so it is testable.
8. **Offline-buffer health is a `devices.buffer_health jsonb` signal written by D4 and rendered by O3** (§3.3); O3 never treats buffered counts as authoritative spend. *Rationale:* the buffer is signed + idempotent and reconciled into `inference_calls` by D4/C3 (DECISIONS §2); O3's role is observability, not accounting.

---

## 9. Acceptance criteria (observable, testable)

Extends the F1 RW12 adversarial harness + C1 integration tests.

1. **Anon lockdown:** an unauthenticated (`anon`) or `authenticated`-but-non-`feature.manage` caller attempting to `INSERT/UPDATE/DELETE` `config.feature_states` via PostgREST is **denied**; the only successful write path is `/rpc/governance/set-feature` with `feature.manage`. (Closes the built anon-writable hole.)
2. **4-state round-trip:** `POST /rpc/governance/set-feature` with each of `locked`/`default_on`/`default_off`/`user_overridable` persists exactly one row per `(feature, scope_type, scope_id)`; an invalid `state` or a `scope_id` mismatched to `scope_type` returns `400`.
3. **Precedence — lock wins broadest:** with workspace=`locked`/off and a space-scope `default_on`, `resolve_feature_state` returns `{enabled:false, governed:true, source:'locked@workspace'}` for a member in that space; the attempted space override write returns `409` (§6.3).
4. **Precedence — most-specific non-locked:** with workspace=`default_off`, space=`default_on`, role=`user_overridable`, a member holding that role in that space gets `mode=user_overridable` and, after setting a `user_preferences=true`, `resolve_feature_state` returns `{enabled:true, governed:false, source:'user'}`; a member **without** that role in the same space gets `{enabled:true, governed:true, source:'space'}`.
5. **User layer inert under lock:** for a `locked` feature, a member setting `user_preferences` does **not** change the resolved value (still `governed:true`, still the locked value).
6. **Server-side enforcement:** a governed runtime feature (`grounded-only` `locked` on) is enforced by C4 on `/v1/chat` **even if** the client omits/forges the toggle (RW12 negative test).
7. **Mandatory floor:** a `mandatory` feature resolves `{enabled:true, governed:true}` for all callers and cannot be exposed as a toggle or overridden.
8. **Seed:** after `dbd reset && dbd apply && dbd import`, a seed tenant has one `scope_type='workspace'` `feature_states` row per `governable` feature, each equal to the catalog `default_state`, and zero rows for `mandatory` features.
9. **Cross-tenant isolation:** a tenant-A JWT reading `resolve_feature_states`, the governance matrix RPC, or `devices` returns only tenant-A data; tenant-B ids yield 0 rows.
10. **Device fleet read:** `GET /v1/devices` (or the fleet read model) lists enrolled devices with `last_seen`, `app_version`, `config_version`, a `buffer_health` verdict, and `sync_policy`; a member without `device.manage` sees only their own devices.
11. **Revoke cuts the hot path:** after the fleet **Revoke** action, a `/v1/chat` bearing that `device_id` returns `403 device_revoked` within ≤ 30 s / immediately on the Realtime signal, despite a valid unexpired JWT — and **no** `inference_calls` row is written for the rejected call.
12. **Hot-path budget:** with a warm `DeviceGuard` cache, the device check adds `< 1 ms` p99 and issues **zero** synchronous DB queries per `/v1/chat` (asserted via the C1 request trace / query counter).
13. **Sync-policy write authz:** `/rpc/devices/set-sync-policy` succeeds with `device.manage` and returns `403` without it; the change is audited (`device.sync_policy_changed`).
14. **Config propagation:** a `set-feature` write bumps the tenant `config_version`; a subscribed device (D4) receives the new `feature_governance.version` and re-resolves without a restart; an offline device re-resolves identically from its cached snapshot.
15. **Audit binding:** every `set-feature`/`clear-feature`/`set-sync-policy` writes an `audit_events` row with `actor_id = auth.uid()`; a client cannot forge the actor. No `public_key`/token material appears in any fleet response or audit payload.

---

## 10. Open questions (genuine)

1. **Group/bulk governance ergonomics.** Setting one feature × one scope is defined; the matrix UI will want **bulk set** (a module across all spaces, or a scope across all features). This is UX/RPC-batching sugar over §4.3 (N single upserts in one transaction) — the batch endpoint shape (`POST /rpc/governance/set-features[]`) and its partial-failure semantics are a W1/C1 detail, not settled here. Does not block O3.
2. **Per-device vs per-user offline grace on forced re-sync.** `sync_policy.offline_grace_h` is per-device; whether a tenant-wide *maximum* grace (a governance-style cap an admin sets once, that no device policy may exceed) is needed is a policy question deferred until fleet operations are exercised. Default: per-device only for v1.
3. **Feature-catalog authorship & versioning.** `config.features`/`modules` is the platform catalog; how new governable features are registered as modules ship (a migration/seed vs. a platform-admin surface) and how a feature's `default_state` change propagates to already-seeded tenants (leave existing workspace rows vs. re-seed) needs a platform-ops decision. Default for v1: catalog is seed-authored; existing tenant rows are left as-is on catalog changes (explicit admin action to adopt a new default).
4. **Stale-device threshold source.** The `buffer_health` "stale" verdict needs an `oldest_pending_at` age threshold; whether it is a fixed constant, a D4 config value, or itself feature-governed is open. Default: a D4 operator-config constant (not hardcoded per DECISIONS no-hardcoded-ops), surfaced read-only in the fleet UI.
