# F2 · Identity, Auth & RBAC — Spec

**Module:** [F2](../modules/F2-identity-auth-rbac.md) · **Status:** Planned (build-ready) · **Depends on:** [F1](./F1-data-model.md) · **Enables:** C1 (auth middleware + gateway-mediated writes), C3 (identity→budget-node resolution), W1 (Organization / roles / device screens), W2 (member sign-in), D1/D4 (desktop session + device enrollment), O1 (audit actor binding), O3 (device fleet)
**Date:** 2026-07-23 · **Authority:** [`../DECISIONS.md`](../DECISIONS.md) §1(#4), §2 (W1/W3, apply-without-asking), §3 (Identity/SSO). Where anything here disagrees with `DECISIONS.md`, that record wins.

---

> **This spec OWNS the authoritative capability enumeration (§4.3).** Every other module (C1, C3, C4, C5, W1, X1, F3, O1–O3) references this list by name; it does not redefine it. F2 also owns the **JWT claims contract** (§4.1) and the **RLS capability-resolution helpers** (§5.2) that F1's policies and C1's middleware both call. Because both authz surfaces (Postgres RLS and the C1 gateway) resolve from the same two artifacts, they are the highest-fan-out contracts in the system — treat their shapes as frozen once ratified.

---

## 1. Purpose & scope

Establish **who a caller is** (authentication) and **what they may do** (authorization) for every plane of Torii. F2 is the source of truth for:

- **Authentication** via Supabase Auth — **magic link (passwordless email) is the primary v1 sign-in** (simplest, Supabase-native), with OAuth (Google, GitHub) optional; the region + IdP shown in mockups are **operator-config, not baked**. SAML SSO + SCIM directory provisioning as a **fast-follow (v1.x)**, with the onboarding step **designed and stubbed** in v1 (DECISIONS §3).
- **JWT verification model** — the central gateway (C1) and Postgres both trust Supabase-issued JWTs verified **RS256 against the JWKS endpoint** (verify-only asymmetric public key), never a shared HS256 secret (§2 W3).
- **Claim injection** — a Supabase `custom_access_token_hook` stamps `tenant_id`, `role_ids[]`, and a `claims_version` onto every access token (§4.1).
- **RBAC** — the full **role + permission matrix** (`roles` / `role_permissions` / `profile_roles`) that replaces the built `profile_tenants.role` enum (decision #4). **Capabilities are resolved server-side** from `role_permissions`; the JWT stays bounded (ids only).
- **Device enrollment & hot-path revocation** — register a device public key → issue a device-bound session; a per-request device-status check on the C1 hot path stops a revoked device from spending even with a live JWT.
- **Tenant auto-assignment by email domain** at first sign-in.

**Out of scope (owned elsewhere):** the physical DDL of the RBAC/device tables (F1 — this spec specifies their shape and the policies over them); provider-credential custody (F3); budget cascade math (C3, keyed on the identity→node mapping F2 resolves); the admin UI itself (W1). Reversible un-redaction, SAML/SCIM runtime, and OS-level device attestation are post-v1.

**Depends on:** F1 (tables + RLS substrate). **Enables:** everything that authorizes — C1, C3, C4, C5, X1, W1, W2, D1, D4, O1, O3.

---

## 2. Responsibilities

1. Configure and operate **Supabase Auth**: providers (email, Google, GitHub), asymmetric (RS256) signing, session/refresh policy, the sign-up → tenant-assignment path.
2. Own the **`custom_access_token_hook`** SQL function and its claim contract.
3. Own the **RBAC schema semantics** (`roles`/`role_permissions`/`profile_roles`), the seeded default roles, and the canonical **capability enumeration**.
4. Provide the **RLS capability-resolution helpers** (`SECURITY DEFINER`) that F1 policies and C1 both authorize from.
5. Provide C1's **JWT verification + device-status middleware** contract (Rust trait shapes).
6. Own **device lifecycle**: enroll (register pubkey → device-bound session), list, revoke; expose `devices.status` for the hot-path check.
7. Own **tenant auto-assignment by verified email domain** and the fallback for unmatched domains.
8. Emit **identity/authz audit events** (role changes, assignments, device enroll/revoke, tenant assignment) to O1.

---

## 3. Data model (F1 tables owned / used)

All tables live in the F1 schema and are created/altered by the **F1 rework** ([`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md), features **RW2** RBAC and the device/tenant fixes in **RW10**). F2 specifies their **shape, invariants, and policies**; F1 emits the DDL.

### 3.1 Owned (RBAC + device + tenant-domain)

| Table | Schema | Key columns | Notes |
|-------|--------|-------------|-------|
| `roles` | `core` | `id uuid pk`, `tenant_id uuid`, `key text`, `name text`, `is_system bool`, `created_at/by` | Per-tenant. Seeded system defaults (§4.2) have `is_system=true` (undeletable, renamable display only). Custom roles allowed. `unique(tenant_id, key)`. |
| `role_permissions` | `core` | `tenant_id uuid`, `role_id uuid fk→roles`, `capability text` | One row per (role × capability grant). `capability` ∈ the canonical set (§4.3), enforced by a `CHECK`/FK to a `capabilities` reference table. `pk(role_id, capability)`. **This is the authoritative grant table resolved server-side.** |
| `profile_roles` | `core` | `tenant_id uuid`, `profile_id uuid`, `role_id uuid`, `assigned_by`, `assigned_at` | User↔role, tenant-scoped, composite FK `(tenant_id, role_id)`. A user may hold multiple roles; effective capabilities are the **union**. `pk(tenant_id, profile_id, role_id)`. |
| `capabilities` | `core` | `key text pk`, `domain text`, `description text` | Reference enumeration of §4.3; the authoritative list, seeded by F2. `role_permissions.capability` FKs here. |
| `tenant_domains` | `core` | `tenant_id uuid`, `domain text unique`, `auto_assign_role_id uuid`, `verified bool` | Drives §6 tenant auto-assignment. `domain` is a verified email domain (e.g. `northwind.co`). |
| `devices` | `app` | `id uuid pk`, `tenant_id`, `profile_id`, `pubkey text`, `name`, `platform`, `app_version`, `config_version`, `last_seen timestamptz`, `buffer_health jsonb`, `status text` | `status ∈ {active, revoked}` (DECISIONS §2 apply-without-asking; F1 RW10 adds `last_seen`+buffer-health). Hot-path revocation reads `status`. |

### 3.2 Used (not owned — read/resolve against)

- `core.profile_tenants` — the user↔tenant membership bridge. Its built **`role` enum is REMOVED** (decision #4 / RW2); it survives only as the membership row (`tenant_id`, `profile_id`, `status`, `active` flag for the caller's active tenant). No authz reads the old enum.
- `core.tenants` — tenant identity (name, primary domain, region). C1/clients need `SELECT` (F1 RW10 grant fix).
- `auth.users` (Supabase) — the identity anchor; `profiles.id = auth.users.id`. `auth.uid()` = the profile id.
- `budget_nodes` — F2 resolves an identity → its budget node(s) for C3 (the org→dept→team→user tree is shared with the role hierarchy). F2 provides the **resolver**; C3 owns the reserve→commit.
- `api_keys` / `service_accounts` (F1 RW4) — F2 defines how a validated key maps to an **identity + capabilities** (§4.4); C1 does the runtime validation.
- `audit_events` (F1 RW8) — F2 writes identity/authz events here (§4.5).

### 3.3 The two hierarchies are one tree

Per decision #4, a **single hierarchical tree (org→dept→team→user)** drives **both** the budget cascade (`budget_nodes`) **and** organizational placement. Roles are **orthogonal** to that tree (a `Member` in Finance and a `Member` in Support hold the same capabilities); placement in the tree governs **budget**, role assignment governs **capabilities**. F2 owns the role/capability axis; C3 owns the budget axis; both key off the same `profile_id`.

---

## 4. Contracts

### 4.1 JWT claims contract (FROZEN)

Access tokens are Supabase-issued, **RS256-signed**, and carry standard claims plus F2's custom claims. C1 and Postgres RLS read **only** what is defined here.

```jsonc
{
  // ── Supabase standard ──
  "iss":  "https://<project>.supabase.co/auth/v1",
  "sub":  "3f1c…",            // = auth.uid() = profiles.id
  "aud":  "authenticated",
  "role": "authenticated",    // Postgres role (NOT an app role)
  "email":"mara@northwind.co",
  "aal":  "aal1",
  "session_id": "…",
  "exp":  1750000000,         // short TTL — see §4.1.1
  "iat":  1749996400,

  // ── F2 custom claims (custom_access_token_hook) ──
  "tenant_id":      "tn_nw_8f21a-uuid",  // the caller's ACTIVE tenant
  "role_ids":       ["role-uuid-a", "role-uuid-b"], // roles held in that tenant
  "claims_version": 7,          // bumped on role-ASSIGNMENT change (§4.1.1)
  "device_id":      "dev-uuid"  // present iff the session is device-bound (desktop)
}
```

**Design rule (RESOLVED default):** the JWT carries **ids, never the capability set**. Capabilities are resolved **server-side** — by RLS helpers (§5.2) in Postgres and by C1's resolver in the gateway — from `role_permissions`. This keeps the token bounded regardless of how many capabilities a role accrues, and lets a permission **grant/revoke take effect immediately** (next request re-resolves) without minting a new token.

#### 4.1.1 Versioning & propagation

- **Token TTL:** access token TTL = **1 hour**; refresh-token rotation enabled. A token is short-lived so stale `role_ids`/`tenant_id` self-heal within an hour.
- **`claims_version`** is a per-user counter (stored in `profiles.claims_version`) **bumped only when the set of `role_ids` or the active `tenant_id` would change** (role assigned/removed, tenant switched, membership revoked). C1 compares the token's `claims_version` to the DB value on the hot path; a mismatch → **401 `token_stale`**, forcing a silent refresh. This closes the "assignment changed but token still valid for ≤1h" window for **security-relevant downgrades** (removal/revocation).
- **Permission (`role_permissions`) changes do NOT bump `claims_version`** — they take effect on the next request via server-side resolution, so no refresh is needed.

### 4.2 Seeded default roles

Reconciles the three divergent mockup role vocabularies (`admin/member`; `Administrator/Editor/Member/Service`; directory groups) into one model. Seeded per tenant with `is_system=true`:

| `key` | Display | Intent | Default capabilities (see §4.3) |
|-------|---------|--------|---------------------------------|
| `owner` | Owner | Tenant root; full control incl. ownership transfer | **all** capabilities |
| `admin` | Administrator | Operate the gateway/tenant | all except `tenant.transfer` |
| `editor` | Editor | Manage content + spaces, no governance/identity | `space.create`, `space.join`, `doc.read/write`, `template.manage`, `dataset.manage`, `chain.read`, `budget.read`, `analytics.read` |
| `member` | Member | Create, ask & share within granted spaces | `space.join`, `doc.read/write`, `budget.read`, `budget.request` |
| `viewer` | Viewer | Read-only | `doc.read`, `chain.read`, `budget.read`, `analytics.read` |
| `service` | Service | Programmatic (service-account) identity | `doc.read`, `chain.read` (+ whatever the issuing admin grants; a `service_account` is its own budget node `kind='service'`) |

Custom roles: an admin with `role.manage` may create tenant-scoped roles and assign any subset of §4.3 they themselves hold (no privilege escalation — see §5.4).

### 4.3 Canonical capability enumeration (AUTHORITATIVE — F2 owns this)

Namespaced `domain.verb`. Every authz check (RLS + C1) names one of these. Adding a capability = adding a row to `core.capabilities` here + wiring its predicate. The set explicitly includes every capability named in `DECISIONS.md`'s RESOLVED defaults, plus the read/lifecycle verbs needed to make the model complete.

| Capability | Domain | Guards |
|------------|--------|--------|
| `member.manage` | identity | invite/remove members, edit `profile_tenants` membership, assign teams |
| `role.manage` | identity | create/edit roles, grant/revoke `role_permissions`, assign `profile_roles` |
| `device.manage` | identity | list/revoke **other users'** devices (self-service enroll/revoke of own device needs none) |
| `tenant.manage` | identity | edit tenant identity, domains, onboarding, residency |
| `tenant.transfer` | identity | transfer ownership (owner only) |
| `budget.read` | budget | view the budget tree + spend |
| `budget.write` | budget | edit `budget_nodes` caps/period/hard-soft/thresholds |
| `budget.request` | budget | submit a `budget_requests` increase |
| `budget.approve` | budget | approve/deny `budget_requests` |
| `chain.read` | routing | view routing chains |
| `chain.write` | routing | edit `fallback_chains`/`fallback_chain_models` (+ per-step plane) |
| `model.manage` | catalog | add/enable models, per-tenant/space/role catalog overrides, pricing |
| `connection.manage` | credentials | connect/rotate/revoke `router_credentials` (BYOK key **and** OAuth connect) |
| `space.create` | knowledge | create a space |
| `space.join` | knowledge | join a space one is entitled to |
| `space.manage` | knowledge | manage membership/settings/classification of owned spaces |
| `doc.read` | knowledge | read documents (subject to classification, §5.3) |
| `doc.write` | knowledge | create/edit documents in permitted spaces |
| `doc.delete` | knowledge | soft-delete documents + retire their chunks (C5) |
| `doc.declassify` | knowledge | lower a document's classification level |
| `retrieval.manage` | knowledge | promote a space's retrieval config to default (C5) |
| `dataset.manage` | knowledge | manage structured datasets + column-sensitivity policy (§3c) |
| `template.manage` | knowledge | manage shared `prompt_templates` |
| `mcp.manage` | tools | register `mcp_servers`, edit per-(role×space) tool allow-lists |
| `governance.manage` | governance | edit masking/retention/redaction-DLP config (classification set stays fixed) |
| `feature.manage` | governance | set 4-state feature governance (workspace/space/role scope) |
| `apikey.manage` | access | issue/rotate/revoke `api_keys` + service accounts |
| `audit.read` | observability | read the audit ledger |
| `audit.export` | observability | create/download filtered ledger or audit exports (O1) |
| `analytics.read` | observability | read O2 analytics |

> Notes: (1) `doc.read`/`doc.write` are capability **floors** — actual visibility is further narrowed by space membership + classification (§5.3), which capabilities cannot override except `doc.declassify`. (2) Self-service actions (enroll **own** device, edit **own** `user_preferences`, submit **own** `budget_requests`, read/write **own** `conversations`) require **no capability** — they are the "self-owned benign writes" of §2 W1 and are gated by ownership in RLS, not by the matrix.

### 4.4 API-key / service-account identity resolution

F1 RW4 owns the tables; F2 owns the semantics C1 implements:

- A presented key is `prefix.secret`. C1 looks up `api_keys` by `prefix`, verifies `hash(secret)`, checks `status='active'` and rate limit.
- The key resolves to an **identity** — a `profile_id` **or** a `service_account_id` — and a **capability scope** = `min(identity's role capabilities, key's declared scope)`.
- **Budget is resolved from the identity, never the key** (§2 W2): the identity → its `budget_nodes` leaf (a `service_account` is `kind='service'`); multiple keys for one identity share that one node.
- C1 synthesizes an internal auth context equivalent to a JWT context (`tenant_id`, effective capabilities, identity id) — RLS/authz downstream is identical whether the caller came via JWT or API key.

### 4.5 Rust trait contracts (consumed by C1)

```rust
/// RS256/JWKS verify-only. Caches JWKS with the endpoint's Cache-Control; refetches on unknown `kid`.
pub trait JwtVerifier: Send + Sync {
    fn verify(&self, bearer: &str) -> Result<Claims, AuthError>;   // signature + exp + iss + aud
}

pub struct Claims {
    pub sub: Uuid,               // profile id
    pub tenant_id: Uuid,
    pub role_ids: Vec<Uuid>,
    pub claims_version: i64,
    pub device_id: Option<Uuid>,
    pub email: String,
}

/// Resolves capabilities server-side from role_permissions (short-TTL cache, Realtime-invalidated).
pub trait CapabilityResolver: Send + Sync {
    fn capabilities(&self, tenant_id: Uuid, role_ids: &[Uuid]) -> Result<HashSet<Capability>, AuthError>;
    fn require(&self, ctx: &AuthContext, cap: Capability) -> Result<(), AuthError>; // Err(Forbidden) if absent
}

/// Hot-path device gate + claims-freshness gate.
pub trait DeviceGuard: Send + Sync {
    /// Err(DeviceRevoked) if a device_id claim maps to status != 'active'.
    /// Err(TokenStale) if claims_version < profiles.claims_version.
    fn check(&self, claims: &Claims) -> Result<(), AuthError>;    // short-TTL cache; Realtime-invalidated
}

pub enum AuthError { InvalidToken, Expired, TokenStale, DeviceRevoked, Forbidden(Capability), RateLimited }
```

`AuthContext` = `{ tenant_id, identity_id, identity_kind: User|Service, capabilities: HashSet<Capability>, device_id }`, assembled by the middleware from either a JWT or an API key (§4.4) and threaded into every C1 handler + the gateway-mediated write path.

### 4.6 HTTP endpoints (C1 domain RPCs for the F2 domain — gateway-mediated writes)

Per the RESOLVED default (DECISIONS §5a), all privileged RBAC/identity **mutations** go through **per-domain C1 control-plane RPCs `/rpc/<domain>/<action>`** that check capabilities server-side (no generic blob, no direct PostgREST write to privileged tables). **Reads** use PostgREST / `GET /v1/...` under RLS. Base host `https://api.torii…`.

| Method + path | Capability | Body / effect |
|---------------|-----------|---------------|
| `POST /rpc/rbac/create-role` | `role.manage` | `{key,name,capabilities[]}` → create tenant role (subset guard §5.4) |
| `POST /rpc/rbac/update-role` | `role.manage` | edit `{id}` name / grant-set (`role_permissions`) |
| `POST /rpc/rbac/delete-role` | `role.manage` | delete `{id}` (blocked if `is_system` or last owner-holding role) |
| `POST /rpc/rbac/assign-role` | `role.manage` | `{profile_id, role_id}` → `profile_roles` insert; bumps target's `claims_version` |
| `POST /rpc/rbac/unassign-role` | `role.manage` | remove assignment; bumps `claims_version` |
| `POST /rpc/members/invite` | `member.manage` | `{email, role_id, node_id}` → invite + placement |
| `POST /rpc/devices/enroll` | *(none — self)* | `{pubkey, name, platform, challenge_sig}` → `{device_id}` (§6.2) |
| `GET  /v1/devices` | *(self)* / `device.manage` for others | list |
| `POST /rpc/devices/revoke` | *(self)* / `device.manage` | set `{id}` `status='revoked'` (hot-path effective ≤ cache TTL) |
| `POST /rpc/tenants/add-domain` | `tenant.manage` | `{domain, auto_assign_role_id}` → verified-domain mapping (§6) |

**Events emitted** (to O1 `audit_events`, actor-bound): `role.created`, `role.updated`, `role.deleted`, `role.assigned`, `role.unassigned`, `member.invited`, `device.enrolled`, `device.revoked`, `tenant.domain_added`, `tenant.assigned` (§6).

### 4.7 Tauri IPC (desktop, D1)

The desktop shell holds a **client-only Supabase session** (memory: Tauri client-only session). IPC commands:

- `auth_sign_in({provider|email,password}) -> Session`
- `auth_sign_out()`
- `auth_current() -> Option<Session>` (access token + expiry; used to bearer C1 calls)
- `device_enroll() -> DeviceId` (generates/loads the local keypair, calls `POST /rpc/devices/enroll`; §6.2)
- `device_status() -> {active|revoked}` (mirrors the hot-path gate for UX)

The desktop stores its **private key in the OS keychain**; the pubkey is registered server-side. Sessions on desktop carry the `device_id` claim.

---

## 5. Security & RLS

### 5.1 JWT verification (RS256/JWKS — §2 W3)

C1 verifies every Supabase JWT with a **verify-only asymmetric public key fetched from the project's JWKS endpoint** (`/auth/v1/.well-known/jwks.json`), matched by `kid`. **No shared HS256 secret** exists in any service — a config/env leak cannot forge a token. JWKS is cached per its `Cache-Control` and refetched on an unknown `kid` (key rotation). Postgres trusts the same tokens (Supabase configures RLS to read `auth.jwt()`); **asymmetric signing must be confirmed/enabled on the Supabase project** as a build prerequisite (front-loaded secret/approval per DECISIONS §3).

### 5.2 RLS capability-resolution helpers (F2 owns; F1 policies call)

Two `SECURITY DEFINER` helpers in `core`, `STABLE`, `search_path` pinned, `EXECUTE` granted to `authenticated`:

```sql
-- role_ids from the verified JWT
create function core.jwt_role_ids() returns uuid[]
  language sql stable as $$ select coalesce(
    (select array_agg((x)::uuid) from jsonb_array_elements_text(auth.jwt()->'role_ids') x), '{}') $$;

-- true iff any of the caller's roles grants the capability, in the caller's tenant
create function core.has_capability(cap text) returns boolean
  security definer set search_path = core, public
  language sql stable as $$
    select exists (
      select 1 from core.role_permissions rp
      where rp.role_id = any(core.jwt_role_ids())
        and rp.tenant_id = (auth.jwt()->>'tenant_id')::uuid
        and rp.capability = cap) $$;
```

Rationale for `SECURITY DEFINER`: `role_permissions` is `service_role`-write-only and not directly selectable by `authenticated` (§5.5); the helper reads it on the caller's behalf under a fixed search_path, returning only a boolean — no rows leak. C1 mirrors the same resolution in Rust (`CapabilityResolver`) so both planes agree.

### 5.3 RLS policy layers (composed per tenant table)

1. **Tenant:** `tenant_id = (auth.jwt()->>'tenant_id')::uuid` on every tenant-scoped table.
2. **Capability (write):** privileged tables are `service_role`-write-only (§5.5); the capability check happens in C1 **before** it uses the service role. For the narrow set of client-writable privileged reads/edits, `core.has_capability('…')` composes into the policy.
3. **Classification (docs/spaces):** space membership + **fixed 4-level** classification (public/internal → tenant members; confidential → space members; restricted → doc/space owner). The recursive group-ACL is retired (F1 RW9) and the legacy `groups[]` claim is **dropped** (F2 no longer injects it).

### 5.4 Tenant isolation & no-escalation invariants

- **Every** F2 table is tenant-scoped by policy; a cross-tenant read returns 0 rows.
- **No privilege escalation:** `role.manage` holders may grant only a **subset of the capabilities they themselves hold** (checked server-side in C1's `/rbac` RPCs). A member cannot grant themselves `role.manage`, cannot `UPDATE profile_roles` via PostgREST (write denied — §5.5), and cannot edit `role_permissions` directly.
- **Owner floor:** the last role holding `tenant.transfer`/full-owner cannot be deleted or unassigned from the last owner (prevents lock-out).
- The removed `profile_tenants.role` enum has **no** authz consumer; a regression that reads it fails the RW12 harness.

### 5.5 Gateway-mediated writes (§2 W1)

`roles`, `role_permissions`, `profile_roles`, `profile_tenants`, `tenant_domains`, and `devices` (except a user's own enroll/revoke) are **`service_role`-write-only**: `authenticated`/`anon` `INSERT/UPDATE/DELETE` are `REVOKE`d; all mutations flow through the C1 `/rbac`, `/members`, `/tenants`, `/devices` RPCs, which enforce §4.3 capabilities. `authenticated` retains tenant-scoped `SELECT` on the readable subset (own roles, own device list, tenant role catalog) plus self-service writes to own device rows.

### 5.6 Secrets & redaction

F2 handles **no provider secrets** (F3). Device private keys never leave the client (OS keychain); only pubkeys are stored. Auth tokens are never logged; audit rows store actor/subject **ids**, never token material or the OAuth secrets. Email/PII in audit payloads is subject to the W5 redaction pass before persistence where applicable.

### 5.7 Device revocation on the hot path (§2 apply-without-asking)

Every C1 inference request runs `DeviceGuard::check` **before** the budget reserve. If the token carries a `device_id` whose `devices.status != 'active'`, the request is rejected (`DeviceRevoked`) even though the JWT is otherwise valid and unexpired — a revoked device **cannot keep spending**. The check reads a **short-TTL cache (≤ 30 s)** invalidated immediately by a **Supabase Realtime** signal on `devices` update, so a revoke propagates in near-real-time without a per-request DB round-trip.

---

## 6. Key flows

### 6.1 First sign-in → tenant auto-assignment by domain

1. User authenticates via Supabase (email or Google/GitHub OAuth). Email is **verified** by the provider/Supabase.
2. On first sign-in, a post-signup path (DB trigger or Edge Function) reads the email domain, looks up `core.tenant_domains` where `verified=true`.
3. **Match:** insert `profile_tenants(tenant_id, profile_id, active=true)` and assign the domain's `auto_assign_role_id` via `profile_roles`; emit `tenant.assigned`.
4. **No match:** the user lands in a **no-tenant** state — the app shows "request access / create workspace"; no capabilities, no data (RLS returns nothing without a `tenant_id` claim).
5. Subsequent sign-ins skip assignment; the hook (6.3) stamps the active tenant + roles.

### 6.2 Device enrollment → device-bound session

1. Desktop generates an **Ed25519 keypair**, stores the private key in the OS keychain.
2. It calls `POST /rpc/devices/enroll` with `{pubkey, name, platform, challenge_sig}` where `challenge_sig` signs a server nonce (proves key possession).
3. C1 verifies the signature, inserts `devices(profile_id, tenant_id, pubkey, status='active', last_seen=now())`, returns `device_id`.
4. The device's Supabase session is bound: the `custom_access_token_hook` includes `device_id` in claims for sessions originating from an enrolled device (device id supplied via session metadata / app_metadata at enroll time).
5. On every C1 call, `DeviceGuard` checks `devices.status` (§5.7).

### 6.3 Token minting — `custom_access_token_hook`

1. Supabase invokes `public.custom_access_token_hook(event jsonb)` on every access-token issue/refresh.
2. The hook reads `event.user_id`, looks up the user's **active** `profile_tenants` row → `tenant_id`; gathers `role_ids` from `profile_roles` for that tenant; reads `profiles.claims_version`; reads the session's `device_id` if present.
3. It returns the event with `claims.tenant_id`, `claims.role_ids`, `claims.claims_version`, and (if device-bound) `claims.device_id` merged in. **No capability set is injected** (resolved server-side).
4. If the user has **no** active tenant (6.1 no-match), only the standard claims are stamped; RLS then returns nothing.

### 6.4 Authorizing a privileged write (RBAC change)

1. Admin (holding `role.manage`) calls `POST /rpc/rbac/assign-role {profile_id, role_id}` with their bearer JWT.
2. C1 middleware: `JwtVerifier::verify` → `DeviceGuard::check` → `CapabilityResolver::require(ctx, role.manage)`.
3. C1 applies the **subset guard** (§5.4): the granting admin must hold every capability the target role confers.
4. C1 (service role) inserts `profile_roles`, **bumps the target's `profiles.claims_version`**, emits `role.assigned` to `audit_events` (actor = admin).
5. Target user's next request carries a stale `claims_version` → `TokenStale` 401 → silent refresh → new token reflects the new role. (If the change was a **removal**, the stale-version gate blocks the old token immediately.)

### 6.5 Authorizing an inference call (read/hot path)

1. C1 receives `/v1/chat` with a bearer JWT (or API key → §4.4).
2. `verify` → `DeviceGuard::check` (device + `claims_version` freshness) → resolve `AuthContext` (tenant + capabilities).
3. Capability gate for the operation (e.g. `doc.read` for RAG context), then **budget reserve** (C3), then engine call.
4. On completion, C1 writes `inference_calls` (service role) with the identity→node attribution F2 resolved.

### 6.6 SSO/SCIM (designed, stubbed in v1)

The onboarding flow (`view-onboarding.jsx`, `view-organization.jsx` IdP directory) **designs** SAML link + SCIM directory import + directory-group→role mapping. In v1 the "Single sign-on" and directory-import steps are **present but stubbed** (the step renders, the wiring is a v1.x fast-follow). Email + Google/GitHub carry v1 auth.

---

## 7. Gateway-crate dependencies

F2 is primarily Supabase + Postgres + C1 middleware; it adds **no** new engine capability. Relevant crate items:

- **No blocking gateway issue is owned by F2.** F2 supplies the `AuthContext` that C1 threads into `sensei-gateway` calls; the crate itself is auth-agnostic.
- **Adjacent (owned by C1/F3, referenced here):** [`../plans/gateway-issues.md`](../plans/gateway-issues.md) **GH-2** (OAuth/bearer provider-credential support) is a *provider-credential* concern (F3), **not** an end-user-auth concern — F2's RS256/JWKS verification is unrelated to it. Called out only to prevent conflation: F2 verifies **Supabase user tokens**; GH-2 is about **outbound provider** OAuth.
- F2's device-status hot-path gate runs in C1 **before** the crate's budget filter / `execute` call (ordering per §6.5); it needs no crate change.

---

## 8. Decisions resolved

Settling the residual questions from the F2 seed doc and W1, per the RESOLVED DEFAULTS:

1. **v1 sign-in = magic link (primary) + optional OAuth; SSO/SCIM = fast-follow (v1.x), designed + stubbed.** *Rationale:* DECISIONS §3 (confirmed 2026-07-23) ratifies **magic link** as the simplest v1 sign-in with optional Google/GitHub OAuth; region + IdP are operator-config. The onboarding mockups keep the SSO/SCIM step so the surface exists, but the SAML/SCIM runtime ships v1.x. Resolves the seed doc's "not ratified" open question.
2. **JWT carries `role_ids` + `tenant_id` + `claims_version`; capabilities resolved server-side.** *Rationale:* keeps the token bounded (a role can accrue arbitrarily many capabilities), lets permission grants take effect immediately, and gives one resolution path shared by RLS (`core.has_capability`) and C1 (`CapabilityResolver`). Supersedes F1's looser "resolved capability set **or** role-ids" wording — F2 fixes it to **role-ids only** in the token.
3. **`profile_tenants.role` enum is removed, not merely demoted.** *Rationale:* decision #4 + RW2; keeping it as a live authz source would reintroduce the escalation hole. It survives only as a membership row; no authz reads it. (A denormalized display cache is permitted but must not be an authz input.)
4. **Device attestation = keypair-only (Ed25519) in v1; OS attestation deferred.** *Rationale:* keypair possession + server-side revocation satisfies the "revoked device cannot spend" requirement (§5.7) with no platform-specific attestation dependency; hardware/OS attestation is a later hardening step. Resolves the seed doc's "attestation depth" question.
5. **Multi-tenant users use an ACTIVE-tenant claim; one tenant per token.** *Rationale:* keeps RLS predicates single-valued (`tenant_id = …`) and avoids array-tenant policy complexity; tenant switch re-mints the token (bumps `claims_version`). v1's domain auto-assignment means most users have exactly one tenant.
6. **`claims_version` bumps only on assignment/membership/tenant change, not on permission-grant change.** *Rationale:* balances immediacy (removals block within the freshness gate) against churn (permission edits don't force every holder to re-auth, since they re-resolve server-side).
7. **Capability enumeration is owned here and closed for v1** (additions require an F2 spec edit). *Rationale:* prevents drift across the ~10 consuming modules; every guard names a value that exists in `core.capabilities`.

---

## 9. Acceptance criteria (observable, testable)

Extends the F1 RW12 adversarial harness (`tests/authz.sql`) + C1 integration tests.

1. **RS256 only:** C1 accepts a valid RS256 Supabase JWT and **rejects** (a) an HS256-signed token, (b) a token signed by an unknown `kid`, (c) an expired token — each returns 401 with the correct `AuthError`.
2. **Claims shape:** a freshly minted token for an assigned user contains `tenant_id`, non-empty `role_ids`, and an integer `claims_version`; a no-tenant user's token contains none of the custom claims and yields 0 rows from every tenant table.
3. **Server-side capability resolution:** `core.has_capability('budget.write')` returns true for a user in a role granted it and false otherwise; a member without `budget.write` calling `POST /rpc/budgets/upsert-node` is denied server-side (403) **even if** the client UI offered the control.
4. **No escalation:** a `role.manage` admin cannot create/assign a role conferring a capability the admin lacks (subset guard rejects it); a member's `UPDATE core.profile_roles`/`role_permissions` via PostgREST is denied.
5. **Enum removed:** the schema contains no `profile_tenants.role` enum column consumed by any policy/function/view (grep-clean); RW12 fails if reintroduced as an authz input.
6. **Device hot-path revocation:** after `POST /rpc/devices/revoke`, an inference call bearing that `device_id` is rejected (`DeviceRevoked`) within ≤ 30 s / immediately on the Realtime signal, despite an unexpired JWT.
7. **Claims-freshness:** removing a user's role bumps `claims_version`; the user's next request with the old token returns `TokenStale` 401 and, after refresh, the token's `role_ids` reflect the removal.
8. **Tenant auto-assignment:** a new sign-in from `@northwind.co` (mapped, verified) is placed in the Northwind tenant with the mapped default role and one audit `tenant.assigned` row; an unmapped domain lands no-tenant with zero data visibility.
9. **Cross-tenant isolation:** a tenant-A JWT reading any F2 table returns only tenant-A rows; tenant-B ids return 0 rows.
10. **API-key identity/budget:** a valid API key resolves to its identity's capabilities (∩ key scope) and its **identity's** budget node; two keys for one service account share one node; a revoked key is rejected.
11. **Audit binding:** every `/rbac`,`/members`,`/devices`,`/tenants` mutation writes an `audit_events` row with `actor_id = auth.uid()`; a client cannot forge an actor.
12. **Seed:** `dbd reset && dbd apply && dbd import` yields the six system roles per seed tenant with the §4.2 capability sets and a populated `core.capabilities` reference matching §4.3 exactly.

---

## 10. Open questions

1. **Tenant-switch UX for genuinely multi-tenant users** — the token model supports it (§8.5), but where the "active tenant" is chosen (a switcher in W1/W2 vs. sub-domain per tenant) is a client decision not yet designed. Does not block F2 build.
2. **`custom_access_token_hook` implementation surface** — SQL function vs. Supabase Edge Function for the tenant-assignment branch (6.1). SQL is simpler and DB-local; an Edge Function is needed only if assignment must call out (e.g. to verify a domain via DNS). Default to SQL; revisit if domain verification needs network I/O.
3. **Realtime vs. polling for the device-status cache invalidation** (§5.7) — Realtime is preferred; if the deployment can't run a Realtime channel per gateway instance, fall back to a ≤30 s TTL poll. Confirm at C1 deploy time.
