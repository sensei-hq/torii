# F3 · Credential vault & crypto — Spec

**Module:** [F3](../modules/F3-key-vault.md) · **Status:** Planned — **build gate: must land before C1 handles any real provider credential** ([`../DECISIONS.md`](../DECISIONS.md) §2 W4) · **Depends on:** F1 (storage lands in F1 RW13), F2 (identity/capabilities/JWT), **GH-2** (cloud-adapter bearer/OAuth support — before real OAuth calls) · **Enables:** C1 (sole decryptor), C2/routing (usable-credential filter), W1 Connections screen
**Date:** 2026-07-23 · **Engine crates:** `sensei-*` @ `v0.4.6` · **Crypto:** AES-256-GCM envelope (DEK/KEK) · **Prod KEK:** cloud KMS/HSM · **Storage:** `public.router_credentials`, `core.tenant_keys` (F1)

---

> ⚠️ **Build gate.** No deployed phase may hold plaintext provider credentials. F3 (envelope vault + lockdown + OAuth auto-refresh) is sequenced **ahead of C1 going live** ([`../DECISIONS.md`](../DECISIONS.md) §2 W4). The at-rest custody carried from `database/` (RLS deny-all + `service_role`-only + AES-256-GCM envelope, C1 sole decryptor) is **already correct — keep it**; this spec generalizes storage to `router_credentials` (API key **and** OAuth), adds the **OAuth auto-refresh worker**, and defines **DEK/KEK + dual-credential rotation**.

---

## 1. Purpose & scope

Define the **provider credential vault**: how Torii stores, protects, refreshes, rotates, and dispenses the provider credentials that fulfil cloud (BYOK) inference — **two credential types per router**: an **API key** (BYOK static secret) and an **OAuth account** (Anthropic-style access + refresh tokens). Credentials are encrypted at rest under a per-tenant DEK wrapped by a master KEK, are readable **only** by the central gateway (`service_role`), and are **never** exposed over any API, RLS view, or to any device or web client.

F3 owns the **crypto envelope**, the **credential lifecycle** (create/connect, rotate, revoke), the **OAuth token auto-refresh worker**, and **DEK/KEK rotation**. It is the "K" in "sure, budgeted access for all via BYOK": once F3 lands, no phase deploys with plaintext keys.

**In scope:** envelope encryption (AES-256-GCM), KEK provider abstraction (KMS/HSM in prod, `TORII_KEK` local-dev only), `router_credentials`/`tenant_keys` storage contract, the decrypt-at-call-time interface C1 consumes, the OAuth refresh worker (placement/cadence/retry/alert/grace), and DEK/KEK + dual-credential rotation.

**Explicitly out of scope:** budget/metering (credentials **carry no budget** — budget binds to identity/node, [`../DECISIONS.md`](../DECISIONS.md) §2 W2); the Connections **UI** (W1, F3 supplies the contract); provider-side inference calls (C1 + the `sensei-cloud-providers` adapter, gated on **GH-2**); non-Anthropic OAuth (v1 = **Anthropic OAuth only**; all other providers = BYOK API key); reversible redaction / secret-mapping stores (§2 W5 → C4, one-way only in v1); field-level dataset encryption (§3c — reuses F3's DEK but owned by C5).

**Depends on:** **F1** (the `router_credentials`/`tenant_keys` DDL + RLS land in F1 RW13); **F2** (JWT capabilities — `connection.manage` gates all mutations; device-status feeds C1, not F3 directly); **GH-2** (the cloud adapter must accept a bearer/OAuth credential before an OAuth account can make a real call). **Enables:** **C1** (assembles `GatewayConfig` by calling F3 to decrypt at call time), **C2** (routing filters to routers with a usable — non-failed, non-expired — credential), **W1** (Connections: connect-via-OAuth / paste-a-key / rotate / revoke).

---

## 2. Responsibilities

1. **Envelope encryption.** Encrypt every credential secret field under a per-tenant **DEK** (AES-256-GCM); wrap each DEK under a master **KEK** held in a cloud **KMS/HSM** in production (`TORII_KEK` env var **local-dev only**). Ciphertext layout `[12-byte IV][16-byte tag][ciphertext]` per field.
2. **Credential lifecycle.** Create/connect (`api_key` paste, `oauth` connect), rotate, and revoke `router_credentials`; support **dual-credential cutover** (two active credentials for one router during rotation, no unique-per-router constraint blocking it).
3. **OAuth token auto-refresh.** A background worker swaps OAuth **access tokens before `expires_at`** by calling the credential's `token_url` with the encrypted refresh token; handles retry/backoff, marks `refresh_status`, emits alerts on failure, and honors a grace window. Anthropic-only in v1.
4. **Dispense to the trusted plane only.** Decrypt credentials **only inside the central gateway** (C1, `service_role`) at call time via the F3 interface; return in-memory, zeroize-on-drop material — **never** persist plaintext, log it, or surface it via any API/view/function.
5. **Rotation.** DEK rotation (re-encrypt a tenant's credentials under a new DEK); KEK rotation (re-wrap DEKs under a new KEK — does **not** touch `router_credentials`).
6. **Audit.** Every credential operation (created/rotated/revoked/refreshed/refresh-failed/decrypted-for-call) emits an `audit_events` row — **actor + credential id + outcome, never the secret**.
7. **Zero-budget invariant.** F3 stores no budget on any credential; nothing in F3 resolves or mutates budget.

---

## 3. Data model (F1-owned; F3 is the authoritative consumer)

The DDL + RLS for these tables land in **F1 RW13** ([`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md)); F3 owns their semantics, crypto layout, and the refresh contract. This section is the authoritative shape reference.

### 3.1 `public.router_credentials` (generalizes the built `router_keys`)

Replaces `public.router_keys` ([`database/ddl/table/public/router_keys.ddl`](../../database/ddl/table/public/router_keys.ddl)). One row = one provider credential for a `(tenant, router)`; `type` discriminates.

| Column | Type | Notes |
|---|---|---|
| `tenant_id` | `uuid` NOT NULL → `core.tenants(id)` ON DELETE CASCADE | tenant-first (F1 convention) |
| `id` | `uuid` DEFAULT `gen_random_uuid()` | row addressing |
| `router_id` | `uuid` NOT NULL → `config.routers(id)` | which provider router this fulfils |
| `type` | `text` NOT NULL CHECK `in ('api_key','oauth')` | credential kind |
| `encrypted_secret` | `bytea` | **`api_key` only** — encrypted BYOK secret, `[IV][tag][ct]` |
| `encrypted_access_token` | `bytea` | **`oauth` only** — encrypted OAuth access token |
| `encrypted_refresh_token` | `bytea` | **`oauth` only** — encrypted OAuth refresh token |
| `expires_at` | `timestamptz` | **`oauth` only** — access-token expiry (drives the refresh window) |
| `scopes` | `text[]` | **`oauth` only** — granted scopes (non-secret) |
| `token_url` | `text` | **`oauth` only** — refresh/token endpoint (non-secret) |
| `oauth_client_id` | `text` | **`oauth` only** — non-secret client id used in the refresh grant |
| `provider_account_label` | `varchar` | display only (e.g. account email); **non-secret**, masked in UI |
| `dek_version` | `integer` NOT NULL | which tenant DEK version encrypted this row (rotation) |
| `label` | `varchar` | human label (e.g. "Prod Anthropic key") |
| `is_active` | `boolean` NOT NULL DEFAULT `true` | soft-disable without delete |
| `priority` | `smallint` NOT NULL DEFAULT `0` | **higher wins** when two active credentials exist (dual-credential cutover) |
| `status` | `text` NOT NULL DEFAULT `'active'` CHECK `in ('active','refreshing','failed','revoked')` | lifecycle/health |
| `last_refreshed_at` | `timestamptz` | **`oauth`** — last successful refresh |
| `refresh_status` | `text` CHECK `in ('ok','failed')` | **`oauth`** — last refresh outcome |
| `refresh_error` | `text` | **`oauth`** — redacted last-failure reason (no token material) |
| `refresh_attempts` | `smallint` NOT NULL DEFAULT `0` | consecutive failed refreshes (backoff/alert threshold) |
| `last_used_at` | `timestamptz` | set by C1 on decrypt-for-call |
| `created_at`/`modified_at` | `timestamptz` NOT NULL DEFAULT `now()` | F1 convention |
| `modified_by` | `varchar` NOT NULL | actor |
| PK | `(tenant_id, id)` | |

**Constraints / indexes**
- **Type integrity** (CHECK): `type='api_key'` ⇒ `encrypted_secret` NOT NULL and all `oauth`/token columns NULL; `type='oauth'` ⇒ `encrypted_access_token`, `encrypted_refresh_token`, `expires_at`, `token_url` NOT NULL and `encrypted_secret` NULL.
- **No `unique(tenant_id, router_id)`** — the built unique key is **dropped** to permit dual-credential cutover; C1 selects the usable credential per router by `is_active AND status IN ('active','refreshing')` ordered by `priority DESC, created_at DESC`.
- Index `router_credentials_active_idx (tenant_id, router_id, is_active, priority DESC)` — C1's resolution path.
- Partial index `router_credentials_refresh_idx (expires_at) WHERE type='oauth' AND is_active AND status IN ('active','refreshing')` — the refresh worker's scan.

### 3.2 `core.tenant_keys` (extended)

Carries the built per-tenant wrapped DEK ([`database/ddl/table/core/tenant_keys.ddl`](../../database/ddl/table/core/tenant_keys.ddl)); F3 adds KEK-version tracking.

| Column | Type | Notes |
|---|---|---|
| `tenant_id` | `uuid` PK → `core.tenants(id)` | one active DEK per tenant |
| `encrypted_dek` | `bytea` NOT NULL | DEK wrapped by the KEK, `[IV][tag][ct]` (KMS-native envelope for cloud KEK) |
| `dek_version` | `integer` NOT NULL DEFAULT 1 | bumped on DEK rotation |
| `kek_version` | `integer` NOT NULL DEFAULT 1 | which KEK wrapped `encrypted_dek` (bumped on KEK rotation) |
| `kek_ref` | `text` | opaque KMS key reference/ARN (prod); NULL for local `TORII_KEK` |
| `created_at`/`modified_at`/`modified_by` | | F1 convention |

### 3.3 `core.tenant_key_archive` (new — rotation safety)

Holds superseded wrapped DEKs so ciphertext encrypted under an older `dek_version` can still be decrypted **during** a rotation (before every `router_credentials` row is re-encrypted). Rows are deleted once no `router_credentials.dek_version` references them.

| Column | Type | Notes |
|---|---|---|
| `tenant_id` | `uuid` → `core.tenants(id)` | |
| `dek_version` | `integer` | archived version |
| `encrypted_dek` | `bytea` NOT NULL | old wrapped DEK |
| `kek_version` | `integer` NOT NULL | KEK that wrapped it |
| `archived_at` | `timestamptz` DEFAULT `now()` | |
| PK | `(tenant_id, dek_version)` | |

### 3.4 Used, not owned

- `config.routers` (which provider a credential fulfils) — read-only to F3.
- `audit.audit_events` (F1/O1) — F3 emits credential-lifecycle rows.
- `alert_rules`/`notification_channels`/`alert_events` (F1 RW8) — F3 raises refresh-failure alerts.
- `budget_nodes` / `inference_calls` — **not referenced** (credentials carry no budget).

---

## 4. Contracts

### 4.1 Rust traits (crate `torii-vault`, consumed by C1's `services/gateway`)

```rust
/// Master-key custody. Prod = cloud KMS/HSM; local-dev = TORII_KEK env var.
/// The DEK plaintext never leaves this trait's implementation boundary except as
/// zeroize-on-drop material handed to the AEAD.
#[async_trait]
pub trait KekProvider: Send + Sync {
    /// Wrap (encrypt) a freshly generated 32-byte DEK. Returns the wrapped blob + the KEK version used.
    async fn wrap_dek(&self, tenant_id: Uuid, dek: &Secret<[u8; 32]>) -> Result<WrappedDek>;
    /// Unwrap (decrypt) a stored DEK for a given KEK version.
    async fn unwrap_dek(&self, tenant_id: Uuid, wrapped: &[u8], kek_version: i32) -> Result<Secret<[u8; 32]>>;
    /// The current active KEK version + opaque reference (ARN / key id); None ref for local dev.
    fn active_kek(&self) -> (i32, Option<String>);
}
// impls: KmsKekProvider (AWS KMS / GCP KMS / Vault Transit — prod), EnvKekProvider (TORII_KEK — local-dev only, refuses to start if used with a prod profile).

/// The credential vault. All methods require a service_role DB handle; there is
/// intentionally no read/decrypt path reachable by anon/authenticated.
#[async_trait]
pub trait CredentialVault: Send + Sync {
    // ---- lifecycle (behind capability `connection.manage`, enforced by the caller/C1) ----
    async fn put_api_key(&self, ctx: &ActorCtx, router_id: Uuid, secret: Secret<String>, label: Option<String>) -> Result<CredentialId>;
    async fn connect_oauth(&self, ctx: &ActorCtx, router_id: Uuid, tokens: OAuthTokens, meta: OAuthMeta) -> Result<CredentialId>;
    async fn rotate_credential(&self, ctx: &ActorCtx, router_id: Uuid, new: NewCredential) -> Result<CredentialId>; // adds a higher-priority credential (dual-credential cutover)
    async fn revoke(&self, ctx: &ActorCtx, credential_id: CredentialId) -> Result<()>;

    // ---- call-time dispense (C1 only) ----
    /// Resolve the usable credential for a router (highest active priority), decrypting in memory.
    /// For `oauth`, transparently reactive-refreshes if the access token is within the grace window
    /// or already expired. Records `last_used_at`. Emits a `credential.decrypted` audit event.
    async fn resolve_for_call(&self, tenant_id: Uuid, router_id: Uuid) -> Result<ResolvedCredential>;

    // ---- crypto rotation (ops) ----
    async fn rotate_dek(&self, tenant_id: Uuid) -> Result<()>;             // re-encrypt all tenant credentials under a new DEK
    async fn rotate_kek(&self, tenant_ids: &[Uuid]) -> Result<()>;         // re-wrap DEKs under the new active KEK
}

pub struct OAuthTokens { pub access_token: Secret<String>, pub refresh_token: Secret<String>, pub expires_at: DateTime<Utc> }
pub struct OAuthMeta   { pub token_url: String, pub scopes: Vec<String>, pub client_id: String, pub account_label: Option<String> }

/// What C1 hands to the sensei-cloud-providers adapter (GH-2). Zeroizes on drop.
pub enum ResolvedCredential {
    ApiKey { secret: Secret<String> },
    Bearer { access_token: Secret<String>, expires_at: DateTime<Utc> },
}
```

### 4.2 OAuth refresh contract (worker ↔ provider token endpoint)

Anthropic-style OAuth (v1). The worker POSTs to `token_url`:

```
POST {token_url}                         Content-Type: application/x-www-form-urlencoded
grant_type=refresh_token
&refresh_token={decrypted refresh_token}
&client_id={oauth_client_id}
--> 200 { "access_token": "...", "refresh_token": "..."?, "expires_in": <seconds>, "scope"?: "..." }
--> 4xx { "error": "invalid_grant" | ... }   ⇒ terminal (refresh token dead → status='failed', alert, manual reconnect)
```

On success: re-encrypt the new access token (and rotated refresh token if returned) under the tenant DEK, set `expires_at = now() + expires_in`, `last_refreshed_at = now()`, `refresh_status='ok'`, `refresh_attempts=0`, `status='active'`. On failure: increment `refresh_attempts`, set `refresh_status='failed'` + redacted `refresh_error`; see §5/§8 for retry/alert/terminal handling.

### 4.3 Events (emitted to O1 audit + O3/alerts)

| Event | When | Payload (no secrets) |
|---|---|---|
| `credential.created` | `put_api_key` / `connect_oauth` | actor, credential_id, router_id, type |
| `credential.rotated` | `rotate_credential` / `rotate_dek` / `rotate_kek` | actor, credential_id(s), from→to version |
| `credential.revoked` | `revoke` | actor, credential_id |
| `credential.decrypted` | `resolve_for_call` | tenant, router, credential_id, call_id (sampled/rate-limited) |
| `oauth.refreshed` | successful refresh | credential_id, new `expires_at` |
| `oauth.refresh_failed` | failed refresh (per attempt) | credential_id, attempt, redacted reason |
| `oauth.refresh_exhausted` | attempts ≥ threshold OR terminal `invalid_grant` | credential_id → drives `alert_events` + channel dispatch |

### 4.4 HTTP / IPC surface

F3 exposes **no public HTTP** and **no Tauri IPC** (desktop never holds provider credentials — central custody only, §8). Mutations reach F3 **only** through C1's gateway-mediated write path (W1 Connections → C1 authz endpoints → `CredentialVault`), which enforces `connection.manage` server-side (§5). The Connections UI reads only **non-secret metadata** (type, label, `provider_account_label`, `status`, `expires_at`, `last_refreshed_at`) via the tenant-scoped SELECT allowed in §5.

---

## 5. Security & RLS

- **RLS deny-all on secrets.** `public.router_credentials`, `core.tenant_keys`, `core.tenant_key_archive`: RLS enabled; **no policy grants `anon`/`authenticated`** INSERT/UPDATE/DELETE, and `SELECT` of secret columns is denied. This matches the built at-rest custody ([`../DECISIONS.md`](../DECISIONS.md) §2 "already correct — keep it") and the F1 §5 secrets rule.
- **`service_role`-only.** Only the central gateway (C1) `service_role` connection reads/writes these tables. `service_role` bypasses RLS; C1 enforces tenant scope + the `connection.manage` capability in code from the validated JWT before any `CredentialVault` mutation.
- **Non-secret metadata read path.** The Connections screen needs status without secrets: expose a **view / column-restricted grant** (`router_credentials_meta`) selecting only `id, router_id, type, label, provider_account_label, is_active, priority, status, expires_at, last_refreshed_at, refresh_status, last_used_at`, tenant-scoped RLS (`tenant_id = (auth.jwt()->>'tenant_id')::uuid`), **SELECT to `authenticated`** — never any `encrypted_*`/`token`/`scopes` column. All raw secret columns remain unreadable.
- **Capability gate.** Every lifecycle mutation (connect/rotate/revoke) requires the `connection.manage` capability (F2's canonical set; F2 owns the authoritative list). C1 checks it server-side; there is no client write path to these tables.
- **KEK custody.** Production KEK in a cloud **KMS/HSM** (`KmsKekProvider`); DEK unwrap is a KMS call, so raw KEK bytes never touch the app process. `TORII_KEK` is **local-dev only** — `EnvKekProvider` refuses to start under a production profile (fail-closed).
- **Secrets never leak.** No secret is logged, returned by any API/view/function, or placed in `refresh_error`/audit payloads. In-memory secrets use `Secret<_>`/zeroize-on-drop. `refresh_error` and all event payloads are pre-redacted (defense-in-depth vs the §2 W5 detector).
- **Redaction interplay.** F3 secrets are structurally isolated (never in prompts/context), so W5 in-flight redaction (C4) is a backstop, not the primary control; F3's control is *never dispensing plaintext outside the trusted boundary*.
- **Tenant isolation.** All vault operations are tenant-scoped by DEK: a tenant's credentials are only decryptable with that tenant's DEK; cross-tenant decrypt is impossible even for `service_role` bugs that skip the `tenant_id` filter (wrong DEK ⇒ AEAD auth failure). Composite FKs keep credentials in-tenant.
- **No budget.** F3 touches no budget table; enforced by the schema (no budget column on `router_credentials`) and by F3 owning no budget code (§2.7).

---

## 6. Key flows

1. **Connect BYOK API key.** W1 Connections → C1 (`connection.manage` checked) → `put_api_key`. F3 loads/creates the tenant DEK (unwrap via `KekProvider`), AES-256-GCM-encrypts the secret with a fresh IV, writes a `type='api_key'` row (`dek_version`, `status='active'`), zeroizes the plaintext, emits `credential.created`. UI shows label only.
2. **Connect OAuth account (Anthropic).** W1 initiates the provider OAuth authorization flow (out-of-band); on callback C1 receives `access_token`/`refresh_token`/`expires_in`/`scopes` → `connect_oauth`. F3 encrypts both tokens under the tenant DEK, stores `expires_at`, `scopes`, `token_url`, `oauth_client_id`, `provider_account_label`, `status='active'`, emits `credential.created`.
3. **Decrypt at call time (C1 hot path).** C1 assembles `GatewayConfig` → for each router calls `resolve_for_call(tenant, router)`. F3 selects the usable credential (`is_active`, `status IN ('active','refreshing')`, highest `priority`), unwraps the DEK, decrypts the secret/access-token, returns a `ResolvedCredential` (zeroize-on-drop), sets `last_used_at`, emits (sampled) `credential.decrypted`. C1 passes it to the `sensei-cloud-providers` adapter (**GH-2** bearer/OAuth support).
4. **Proactive OAuth refresh (worker).** Every tick (see §8), the worker scans the `router_credentials_refresh_idx` for `oauth` credentials with `expires_at < now() + grace_window`, takes a per-row `FOR UPDATE SKIP LOCKED`, sets `status='refreshing'`, decrypts the refresh token, POSTs `token_url` (§4.2), re-encrypts the new tokens, updates `expires_at`/`last_refreshed_at`/`refresh_status='ok'`/`status='active'`, emits `oauth.refreshed`.
5. **Reactive OAuth refresh (on 401).** If a live call fails with 401 despite a not-yet-expired token, C1 asks F3 to refresh-now for that credential (same path as flow 4, single-flighted by the row lock), then retries once before failing the router over to the C2 fallback chain.
6. **Refresh failure → retry → alert.** On a failed refresh, F3 increments `refresh_attempts`, sets `refresh_status='failed'` + redacted `refresh_error`, emits `oauth.refresh_failed`, and backs off (§8). On a terminal `invalid_grant` or attempts ≥ threshold, sets `status='failed'`, emits `oauth.refresh_exhausted` → `alert_events` + channel dispatch (email/Slack/webhook). C2 excludes `status='failed'` credentials from routing; the router falls through its fallback chain and Connections shows "needs reconnect".
7. **Grace window.** While `now() < expires_at`, the existing access token stays usable even if a refresh attempt is failing — calls keep succeeding until actual expiry, giving the worker its retry budget. Only once the token is expired **and** unrefreshable does the credential become unusable (flow 6).
8. **Dual-credential rotation (zero-downtime).** `rotate_credential` inserts a **new** credential for the same router at higher `priority` (`status='active'`), leaving the old one active. C1 immediately prefers the new one (flow 3); once traffic is confirmed healthy, ops calls `revoke` on the old credential. No `unique(tenant_id, router_id)` blocks the overlap.
9. **Revoke.** `revoke` sets `status='revoked'`, `is_active=false`; the row is excluded from resolution immediately, emits `credential.revoked`. (Row retained for audit; secrets remain encrypted.)
10. **DEK rotation.** `rotate_dek(tenant)`: generate a new 32-byte DEK, wrap under the active KEK (bump `dek_version`), archive the prior wrapped DEK (`core.tenant_key_archive`), then in a transaction re-decrypt (old DEK) + re-encrypt (new DEK) **every** `router_credentials` row for the tenant, updating `dek_version`; delete the archive row once unreferenced. Emits `credential.rotated`.
11. **KEK rotation.** `rotate_kek(tenants)`: for each tenant DEK, unwrap under the old KEK version, re-wrap under the new active KEK, bump `kek_version`/`kek_ref`. **`router_credentials` is untouched** (only `encrypted_dek` changes). Emits `credential.rotated`.

---

## 7. Gateway-crate dependencies

- **GH-2 — OAuth/bearer provider-credential support in `sensei-cloud-providers` (BLOCKING).** Today `RouterConfig` carries only `api_key`/`api_key_env` and `base.rs::resolve_api_key` does a static `bearer_auth(key)`; there is no OAuth access/refresh/expiry or 401-triggered refresh ([`../plans/gateway-issues.md`](../plans/gateway-issues.md) GH-2). The adapter must accept a **first-class bearer/OAuth credential** (the `ResolvedCredential::Bearer` from §4.1) that cooperates with F3's refresher, and surface a 401 signal C1 can turn into a reactive refresh (flow 5). **Sequenced before** the F3/C1 phase that handles a real OAuth account; filed as a gateway-repo issue (create → implement → close, released via the lockstep tag bump). BYOK `api_key` credentials work on the crate as-is.
- **No other crate enhancement is required** for F3's crypto/storage/refresh — the envelope, worker, and rotation are Torii-side. `GatewayStore`/`inference_calls` (GH-5) and the reserve→commit (GH-4) are C3/O1 concerns; F3 credentials deliberately do **not** interact with them.

---

## 8. Decisions resolved

Settling the F3 module's residual open questions per the ratified DEFAULTS:

- **Refresh-worker placement → co-located with the central gateway (C1), as a background `tokio` task in the `service_role` process** (or a sibling scheduled worker sharing the same DB + `KekProvider`). *Rationale:* only the central plane has KMS + `service_role` access and reuses the exact decrypt path; keeping it there avoids a second secret-bearing deployment and matches "decrypt only in the trusted central gateway." Desktop/device planes never refresh (central custody, §8 below).
- **Cadence → 60-second tick; proactive-refresh window (grace) = 10 minutes before `expires_at`.** Any `oauth` credential expiring within 10 min is refreshed on the next tick, giving ~10 refresh attempts before real expiry. Plus **reactive refresh on 401** (flow 5). *Rationale:* small fixed tick is cheap (partial-index scan) and bounds staleness; a 10-min window comfortably exceeds retry/backoff budget.
- **Failure/retry → per-tick exponential backoff, alert on exhaustion.** Retries within a tick use short backoff; across ticks `refresh_attempts` accumulates. Alert threshold = **3 consecutive failed refreshes** OR a terminal `invalid_grant` → `status='failed'` + `oauth.refresh_exhausted` → `alert_events`. *Rationale:* transient provider/network blips self-heal silently within the grace window; only genuine failures (dead refresh token, sustained outage) page an operator.
- **Grace window → the current access token stays valid until its real `expires_at`** even while refreshes are failing (flow 7). A live OAuth call only fails once the token is expired **and** unrefreshable, at which point C2 fails the router over to its fallback chain. *Rationale:* decouples refresh-worker health from request success; a brief provider outage never breaks inference if a valid token is still in hand.
- **Concurrency of refresh → single-flight via `SELECT … FOR UPDATE SKIP LOCKED` per credential row**, so multiple worker instances / a reactive + proactive refresh never double-swap or race a rotated refresh token. *Rationale:* matches the reserve-lock discipline used for budgets; avoids invalidating a just-rotated refresh token.
- **Custody model → `server-proxied` (central custody) only in v1.** The per-router `device-local` option (which would require re-wrapping DEKs for each device) is **deferred**; desktop steps that need a cloud credential proxy through C1. *Rationale:* central custody keeps the "no plaintext outside the trusted boundary" invariant simple and matches [`../DECISIONS.md`](../DECISIONS.md) (device pulls a config snapshot with **no secrets**).
- **OAuth provider scope → Anthropic only in v1** (build + test connect/refresh for Anthropic); all other providers use BYOK `api_key`. *Rationale:* [`../DECISIONS.md`](../DECISIONS.md) §3 — generalize the OAuth flow later.
- **KEK provider → cloud KMS/HSM in prod (`KmsKekProvider`); `EnvKekProvider`/`TORII_KEK` local-dev only, fail-closed under a prod profile.** *Rationale:* §2 W4; KEK bytes never enter the app process in prod.
- **Redaction of secret mappings → one-way only in v1** (no reversible mapping store); F3 stores no redaction mappings — it is the *source* being protected, and its control is non-dispensation, not redaction. *Rationale:* §2 W5.

---

## 9. Acceptance criteria (observable, testable)

1. **Deny-all secrets.** An `authenticated` JWT `SELECT * FROM public.router_credentials` (and `core.tenant_keys`, `core.tenant_key_archive`) returns **0 rows / permission denied**; no `encrypted_*`, `token`, `scopes`, or `token_url` column is reachable by any client role via table, view, or function.
2. **Metadata read works without secrets.** An `authenticated` member reads `router_credentials_meta` for their own tenant and sees `status`/`label`/`expires_at`/`provider_account_label` etc. — and **no** secret/token column exists in that grant; cross-tenant read returns 0 rows.
3. **Capability gate.** A caller without `connection.manage` attempting connect/rotate/revoke (through C1) is **rejected server-side**; with the capability it succeeds.
4. **API-key round-trip.** After `put_api_key`, `resolve_for_call` returns a `ResolvedCredential::ApiKey` whose decrypted value equals the input; the DB stores only ciphertext; a wrong-tenant DEK fails AEAD authentication (no silent wrong-plaintext).
5. **OAuth connect + dispense.** After `connect_oauth`, `resolve_for_call` returns a `Bearer` with a non-expired `access_token`; both tokens are stored encrypted; `type`/CHECK integrity holds (`api_key` fields NULL).
6. **Proactive refresh.** Given an `oauth` credential with `expires_at` inside the 10-min window, within one tick `expires_at` advances, `last_refreshed_at` updates, `refresh_status='ok'`, and an `oauth.refreshed` event exists — with no client-visible token change.
7. **Reactive refresh on 401.** Given a 401 from the adapter on a not-yet-expired token, F3 refreshes once and C1 retries; success is transparent to the caller.
8. **Failure → alert, grace honored.** Given a provider that returns `invalid_grant`, after the threshold the credential becomes `status='failed'`, an `alert_events` row + channel dispatch exist, and C2 excludes it from routing; while a valid token remains (pre-expiry), calls keep succeeding.
9. **Single-flight refresh.** Under two concurrent refreshers for the same credential, exactly one token swap occurs (row lock); the refresh token is never invalidated by a lost race.
10. **Dual-credential cutover.** After `rotate_credential`, both credentials coexist; `resolve_for_call` returns the higher-priority (new) one; after `revoke` of the old, only the new resolves — with **no call failing** during the overlap.
11. **DEK rotation.** `rotate_dek` re-encrypts every tenant credential under a new `dek_version`; all pre- and post-rotation credentials still decrypt correctly; the archive row is removed once unreferenced.
12. **KEK rotation.** `rotate_kek` re-wraps the DEK (bumps `kek_version`) without modifying any `router_credentials` row; credentials still decrypt.
13. **No plaintext leak.** Across logs, `refresh_error`, audit payloads, and error responses, no secret/token substring appears (verified by a scan test); local `TORII_KEK` startup under a prod profile **fails closed**.
14. **Build gate.** C1's real-credential path is guarded so it cannot decrypt/use a provider credential unless the F3 vault (envelope + lockdown) is present — no plaintext-env fallback deploys.
15. **No budget coupling.** `router_credentials` has no budget column and F3 emits/consumes no budget event; two API keys for one identity, when exercised, accrue spend to the identity's single budget node (verified via C3), not per-credential.

---

## 10. Open questions

- **KMS provider selection & envelope mode.** Which managed KMS (AWS KMS vs GCP KMS vs Vault Transit) backs `KmsKekProvider`, and whether to use KMS-native envelope (`GenerateDataKey`) vs app-side AEAD with a KMS-wrapped DEK — pin at the deployment-topology decision (tracks C1's multi-region open question).
- **Anthropic OAuth grant specifics.** Exact `token_url`, client-registration model (public vs confidential client), scope strings, and whether refresh-token rotation is enforced — confirm against Anthropic's current OAuth docs when GH-2 is implemented (adjust §4.2 accordingly).
- **KEK rotation trigger & cadence.** Scheduled (e.g. annual) vs on-incident, and whether it runs online in-process or as an ops job — an operational policy question, not a schema blocker.
- **Decrypt-audit volume.** `credential.decrypted` on every call may be high-volume; confirm sampling/rate-limit vs full capture with O1 (the ledger already records the call).
