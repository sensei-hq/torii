---
title: F3 BYOK credential vault — per-tenant keys via a per-call credential on the request
description: Store provider API keys sealed in the DEK/KEK vault and make the vault the runtime credential source, with true per-tenant BYOK served by an opaque per-call credential map on InferenceRequest (option C). One shared Gateway; the sensei-gateway crate gains a small tenant-agnostic enhancement. OAuth deferred.
type: blueprint
status: blueprint
created: 2026-07-27
depends_on:
  - docs/analysis/v1-roadmap-completion-and-gaps.md
  - docs/DECISIONS.md
related_issues: []
references:
  - services/gateway/src/vault.rs
  - services/gateway/src/crypto.rs
  - services/gateway/src/keys.rs
  - services/gateway/src/routes/rpc.rs
  - services/gateway/src/routes/chat.rs
  - services/gateway/src/main.rs
  - gateway/crates/kernel/src/types/request.rs (InferenceRequest — new credentials field)
  - gateway/crates/gateway/src/engine.rs (dispatch honors per-call credentials)
  - gateway/crates/cloud-providers/src/base.rs (resolve_api_key precedence)
  - apps/admin/src/routes/(app)/connections/+page.svelte
---

# F3 BYOK credential vault — per-tenant keys via a per-call credential (option C)

## Objective
Let a workspace admin store a provider API key **sealed at rest** (tenant DEK → KEK envelope) in
`router_keys`, and make the **vault the authoritative runtime credential source** (retiring the
plaintext-env shim), with **true per-tenant BYOK** — tenant A's key used only for tenant A's calls. The
crypto (`seal_credential`/`unseal_credential`) already exists; this is the **write path + a per-call
credential primitive on the engine + admin UI**.

**Shaping decision — the crate stays tenant-agnostic; the wrapper resolves the key and passes it per
call.** `sensei-gateway` has no tenant concept and gains none. It gains one small, tenant-agnostic
primitive: `InferenceRequest.credentials: {router → api_key}` — an **opaque per-call override** the engine
prefers when dispatching. The tenant-aware **`torii-gateway` wrapper** resolves `(tenant, router) → key`
from the vault and fills that map per request. One **shared** Gateway serves all tenants; there is **no
per-tenant instance or cache of Gateways** — only a tiny `tenant → {router: key}` map cache. This scales
flat past 10+ tenants (chosen over option B's per-tenant `Gateway` cache, which needs eviction/rebuild
machinery we'd later delete). Cost: a small crate enhancement + one lockstep release bump.

> **Circuit breakers stay shared** (keyed on `router:model` = provider health, which is genuinely shared
> across tenants). Bad-BYOK-key failures surface as auth errors, which don't trip the fallback breaker.

## Architecture

```
                       ADMIN (Connections screen, connection.manage cap)
                                  │ paste key / rotate / revoke  (per workspace)
                                  ▼
                  POST /rpc/connections/{connect,rotate,revoke}          (rpc.rs)
                                  │  capability-gated, audited, key write-only
                                  ▼
                   ┌────────────────────────────────────────────┐
                   │  Vault (torii-gateway)                      │
                   │  • ensure_tenant_dek()  NEW (lazy-provision)│──► core.tenant_keys (encrypted_dek)
                   │  • store/rotate/revoke_router_key()  NEW    │──► public.router_keys (encrypted_api_key,
                   │  • resolve_tenant_keys() NEW (decrypt map)  │        is_active, credential_type)
                   └────────────────────────────────────────────┘
                                  │ after any write → invalidate keymap[tenant]
                                  ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  TenantKeyCache (torii-gateway, SharedState)    tenant_id → {router: api_key}  │
   │  miss ⇒ Vault::resolve_tenant_keys(tenant)  (decrypt active rows)              │
   │  invalidated on connect/rotate/revoke for that tenant                          │
   └──────────────────────────────────────────────────────────────────────────────┘
                                  │ per-request key map (this tenant)
                                  ▼
   POST /v1/chat ─► tenant_id from JWT ─► ireq.credentials = keymap ─► ONE shared Gateway::execute
                                                     │
                                     engine dispatch: RouterConfig.api_key ← ireq.credentials[router]
                                                     │  (else config.api_key ← platform, else env — interim)
                                                     ▼   adapter resolve_api_key(config)
```

## Components

### Crate enhancement (gateway-repo issue — file it) — NEW, tenant-agnostic
1. **`InferenceRequest.credentials: HashMap<String, String>`** (`crates/kernel/src/types/request.rs`),
   `#[serde(default, skip_serializing_if = "HashMap::is_empty")]` — router → api_key, opaque. Custom
   `Debug` must redact values (mirror `RouterConfig`'s key-hiding Debug).
2. **Engine honors it** (`crates/gateway/src/engine.rs`, in the candidate loop of `execute` +
   `execute_stream`): before dispatch, if `request.credentials.get(&candidate.router)` is set, dispatch
   against a `RouterConfig` clone with `api_key = Some(that)`; else use the candidate's config unchanged.
   `resolve_api_key` already prefers `config.api_key`, so no adapter change.
3. Test: a request carrying a `credentials` entry for a keyless router authenticates from the override.
Released via the lockstep tag bump before the wrapper cutover (step 6).

### Vault (`services/gateway/src/vault.rs`) — extend
Owns all sealing + persistence; the only place plaintext keys are handled (`Zeroizing`, never logged).
- `ensure_tenant_dek(pool, tenant)` **NEW** — no `tenant_keys` row ⇒ generate a 32-byte DEK (`OsRng`),
  `seal_dek(&kek, &dek)` (**new crypto fn**), insert `dek_version=1`. Idempotent.
- `store_router_key(pool, tenant, router_id, label, plaintext) -> Uuid` **NEW** — `ensure_tenant_dek`,
  `seal_credential`, upsert one **active** `api_key` row per `(tenant, router_id)`.
- `rotate_router_key(...)` **NEW** — seal new, flip prior active `is_active=false`, insert new (audit-preserving).
- `revoke_router_key(...)` **NEW** — `is_active=false`.
- `resolve_tenant_keys(pool, tenant) -> HashMap<router_name, String>` **NEW** — decrypt active `api_key`
  rows into a `router_name → key` map (keyed by the name the engine matches on). Feeds the cache.

### `crypto::seal_dek` (`services/gateway/src/crypto.rs`) — NEW (small)
Mirror of the tested `seal_credential`, sealing a DEK under the **KEK**: `seal_dek(kek, dek) ->
[IV][tag][ct]`; round-trips with the existing `unseal_dek`.

### TenantKeyCache (`services/gateway/src/state.rs`) — NEW (lightweight)
`RwLock<HashMap<Uuid, Arc<HashMap<String, String>>>>` (or `DashMap`) — `tenant → {router: key}`. On miss,
`Vault::resolve_tenant_keys`; `invalidate(tenant)` on any credential write. Small (a few short strings per
tenant); no eviction needed at v1 scale, but bounded later if required.

### Per-request injection (`services/gateway/src/routes/chat.rs`) — MODIFY
Resolve `tenant_id` from the JWT, `ireq.credentials = cache.get(tenant)` (tenant vault keys). Routers not
in the map fall through to the config/env platform key (interim), with a one-line `WARN` when env is used
(makes the env→vault cutover observable — doc gap G2). C6 judge (fixed local $0 chain) sets no credentials.

### `/rpc/connections/*` routes (`services/gateway/src/routes/rpc.rs`) — NEW
Established `/rpc/*` pattern (capability check → `service_role` mutate → audit → `{ok:true}`).
- `connect { router, key, label? }`, `rotate { router, key }`, `revoke { router }`.
- Capability **`connection.manage`**; keys **write-only** (never returned).
- On success → `state.tenant_keys.invalidate(tenant)`.

### Admin Connections UI (`apps/admin/.../connections/+page.svelte`, `lib/api.ts`) — MODIFY
Provider grid → interactive **Connect**/**Rotate**/**Revoke** per router → `api.connect/rotate/revokeConnection`
→ new RPCs. State from `GET /v1/connections`; never render the secret back.

## Data flow

```mermaid
sequenceDiagram
    participant A as Admin (Connections)
    participant R as /rpc/connections/connect
    participant V as Vault
    participant DB as tenant_keys / router_keys
    participant C as TenantKeyCache
    participant G as shared Gateway
    A->>R: POST {router, key}  (JWT tenant, connection.manage)
    R->>V: ensure_tenant_dek(tenant); store_router_key(...)
    V->>DB: seal DEK if absent; seal(key) → upsert active row
    R->>C: invalidate(tenant)
    R-->>A: {ok:true}   // key never returned
    Note over A,G: later /v1/chat (same tenant)
    A->>C: /v1/chat → cache.get(tenant) (decrypt-on-miss)
    C-->>G: ireq.credentials = {router: key}
    G->>G: dispatch clones RouterConfig.api_key = override
    Note over G: THIS tenant's key; other tenants unaffected; no env, no restart
```

## Integration points
| Integration | Method | Notes |
|-------------|--------|-------|
| Crate `InferenceRequest.credentials` + dispatch | **new (crate)** | opaque router→key override; engine-local, tenant-agnostic |
| Crate `resolve_api_key` precedence | existing | already prefers `config.api_key` → override wins with no adapter change |
| `crypto::seal_credential`/`unseal_*` | existing, tested | seal on store, unseal in resolver |
| `crypto::seal_dek` | **new (small)** | seal a freshly-generated tenant DEK under the KEK |
| `router_keys` / `core.tenant_keys` | existing (per-tenant) | write-path targets; DEK lazy-provisioned |
| `/rpc/*` + `connection.manage` | existing pattern | new connect/rotate/revoke handlers |
| Audit (`audit_events`) | existing | every connect/rotate/revoke emits a row |
| Admin `lib/api.ts` + Connections screen | existing (read-only) | add write methods + buttons |

## Dependencies
| Dependency | Status | Impact if missing |
|-----------|--------|-------------------|
| **Crate: `InferenceRequest.credentials` + dispatch honoring it** | ⛔ to file (GH) | **critical path** — wrapper cutover blocks on the released tag |
| `crypto::seal_credential` (write crypto) | ✅ exists, tested | — |
| Operator tenant DEK | ✅ seeded | platform-fallback keys; other tenants lazy-provision |
| `TORII_KEK`/`STRATEGOS_KEK` (dev KEK) | ✅ present | vault fails closed without it |
| Prod KMS/HSM KEK | ⛔ deferred (ops) | dev env-KEK only; not a blocker |
| GH-2 — OAuth/bearer adapter (crate) | ⛔ | only for the OAuth credential type (excluded) |

## Implementation order (bottom-up, innermost first)
1. **Crate:** `InferenceRequest.credentials` (redacting Debug) + engine dispatch honors it in
   `execute`/`execute_stream` + test. **Release via lockstep tag bump.**
2. **`crypto::seal_dek`** + round-trip test.
3. **Vault write/resolve methods** (`ensure_tenant_dek`, `store/rotate/revoke_router_key`,
   `resolve_tenant_keys`) + tests (seal→store→decrypt; rotate deactivates prior; DEK auto-provision).
4. **TenantKeyCache** in `state.rs` + `invalidate`.
5. **Per-request injection** in `chat.rs` (set `ireq.credentials`; env-fallback WARN); retire startup
   `env_key_resolver` as the sole path (kept as platform fallback).
6. **`/rpc/connections/*`** handlers (capability-gated, audited) + `invalidate` on write. *(needs step 1's
   released tag).*
7. **Admin Connections UI** + `api.ts` methods.
8. **Live E2E** — tenant A connects key K → `/v1/chat` uses K with the env var **unset**; rotate → new key;
   revoke → platform-fallback/denied; a *second* tenant's calls never use A's key (isolation).
9. **Doc** the env→vault cutover (G2).

## Personas
No `.sensei/personas/*.md` defined. Implicit actors: **Workspace admin** (connects/rotates keys for their
tenant; never sees them again; enforcement on the next call, isolated from other tenants);
**Security/operator** (zero plaintext keys at rest or in logs; env path visibly retired; every credential
change audited; one tenant's keys never reachable by another; per-call credentials redacted in
logs/traces).

## Out of scope (tracked elsewhere)
- **OAuth credential type + refresher** (Anthropic) — deferred per user; needs crate **GH-2**. Schema
  (`encrypted_oauth`, …) already present.
- **Option B — per-tenant `Gateway` instances** — the no-crate-change alternative; rejected for v1 because
  it needs cache/eviction machinery that doesn't scale as cleanly and would be deleted on the move to C.
- **Production KMS/HSM KEK** — ops task; dev env-KEK stands in.
- **`router_keys` → `router_credentials` rename** (DECISIONS §2) — cosmetic; do it when OAuth lands.
