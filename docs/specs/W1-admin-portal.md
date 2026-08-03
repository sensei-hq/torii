# W1 · Admin Portal — Spec

**Module:** [W1](../modules/W1-admin-portal.md) · **Plane:** Web (client) · **Status:** Planned — build-ready
**Depends on:** [W4](../modules/W4-design-system.md) (Rokkit token map + dark skin — blocks build, mockup-review #42), [F2](F2-identity-auth-rbac.md) (JWT/JWKS + RBAC matrix + capabilities + device lifecycle), [F3](F3-key-vault.md) (Connections contract), [C1](C1-gateway-service.md) (all privileged writes via `/rpc/*` + reads), [C2](C2-routing-resilience.md) (chain editor + binding + simulator), [C3](C3-budgets-metering.md) (budget tree + alerts + requests), [C4](C4-governance-runtime.md) (governance/DLP policy editor + why-this-model trace), [C5](C5-rag-document-intelligence.md) (Spaces & KB config), O3 (Feature management + Device fleet backends), X1 (Tools & MCP registry)
**Enables:** the entire admin surface — the only place a tenant admin configures what the gateway enforces
**Date:** 2026-07-23 · **Framework:** SvelteKit + Rokkit (W4) → Cloudflare Pages · **Domain:** `seiki.sensei-hq.com`
**Authority:** conforms to [`../DECISIONS.md`](../DECISIONS.md) (§2 W1–W5, §3, §4, §6) and the Wave-1 core specs. Where this spec and any other doc disagree, `DECISIONS.md` wins; the mockups under `docs/mockups/app/*.jsx` remain the authoritative **UI** ground truth (reconciled through [`../design/mockup-review.md`](../design/mockup-review.md)).

---

> **Framing.** W1 is a **client**. It owns **no F1 schema** and defines **no HTTP surface of its own** — every privileged mutation is a call to a C1 `/rpc/*` (or C1-hosted `/v1/*` domain-RPC) endpoint that checks the caller's capability **server-side**; every read is a tenant-scoped PostgREST `SELECT` under RLS (or a C1 read endpoint). W1's job is to render the ratified admin surface, gate controls by the caller's resolved capabilities for UX only, and never be the authority for anything. The security posture (§2 W1) means a W1 bug can *offer* a control the user may not use, but the server still rejects an unauthorized write.

---

## 1. Purpose & scope

W1 is the **tenant & gateway administration web app** — where an admin configures everything the central gateway enforces: identity/RBAC, the single budget tree, routing chains, provider connections, governance/DLP, catalog, spaces, tools, features, devices, alerts, and prompts. It is one of the two first-party clients (`admin.jsx`; the member console `app.jsx` is W2).

**In scope:** the SvelteKit app, its route/screen map, the shared **data-access layer** (a typed client that wraps C1 `/rpc/*` + `/v1/*` and PostgREST reads under the Supabase browser session), capability-driven control gating, the cross-cutting shell affordances (execution-location badges, offline/sync state, locked-toggle visual), and porting the mockup screens onto Rokkit (W4). Screens: **Overview, Requests & audit, Organization, Onboarding, Models, Routing, Connections, Governance, Budgets & billing, Spaces & KB, Tools & MCP, Feature management, Device fleet, Alerts, Prompt library, Settings**.

**Out of scope (owned elsewhere, called by W1):** every server contract W1 consumes — auth/RBAC/device runtime (F2), credential crypto + OAuth refresh (F3), the reserve→commit + alert evaluation (C3), chain resolution + simulator (C2), governance/redaction runtime + policy backend (C4), retrieval/ingestion (C5), MCP registry + allow-list enforcement (X1), feature-state + device-fleet backends (O3), the audit/analytics stores (O1/O2). W1 also does **not** own the member console (W2), the desktop shell (D1), or the marketing site (W5). Local-models `[desktop]` and Compare live in the desktop/member surfaces, not the admin portal (noted in §10).

**Depends on:** W4 (Rokkit tokens — build blocker, mockup-review #42), F2/F3/C1–C5, O3, X1. **Enables:** the admin persona's entire workflow; it is the write-side counterpart to the read-only member spend/activity surfaces in W2.

---

## 2. Responsibilities

1. **Render the ratified admin surface** (§4 screen map) on SvelteKit + Rokkit, porting `admin.jsx` + its `view-*.jsx` screens and authoring the new screens per [`../design/mockup-review.md`](../design/mockup-review.md) §A/§B/§C (no screens invented beyond that ratified set).
2. **Route every privileged mutation through C1** `/rpc/*` / `/v1/*` domain RPCs (never a direct PostgREST write to a privileged table) — §2 W1.
3. **Read tenant data** via PostgREST under RLS (or C1 read endpoints), tenant-scoped by the JWT `tenant_id` claim; never trust a client-set tenant/role.
4. **Gate controls by resolved capabilities** for UX (hide/disable a control the caller lacks the capability for), while treating the **server as the sole authority** — a shown control that is server-rejected must surface the 403 gracefully.
5. **Present the single budget tree** (Organization = editable; Budgets & billing = same tree read-only) with hard/soft/period/alert-threshold/free-floor per node, backed by C3.
6. **Make the four read-only editors editable** — Connections (OAuth-connect + paste-key + rotate/revoke), Routing (chain editor + per-step plane + binding), Models (add/enable + overrides + pricing), Governance (masking/retention/**redaction-DLP** + classification relabel) — each through its owning module's C1 RPC.
7. **Host the permission matrix** (role × capability over the org→dept→team→user tree), reconciling the three divergent mockup role vocabularies into F2's one model.
8. **Own API keys & service accounts** (moved from Billing to Organization) with reveal-once issuance, scope/rate-limit/rotate/revoke, and **no per-key budget** field (spend rolls up to the identity's node).
9. **Render governed-control state** — 4-state feature governance (locked/default-on/default-off/user-overridable) with the locked-toggle visual; masked-only secrets; the "N redacted" indicator; execution-location badges driven by the **per-step plane** (not `route==='Ollama'`).
10. **Surface health, audit, and analytics reads** — Overview KPIs, Requests & audit (filters, exec-location + device columns, why-this-model trace, budget-increase approval queue), provider health, device fleet, alert history.

---

## 3. Data model (F1 tables used)

W1 **owns no tables** and authors **no DDL**. It reads (PostgREST/RLS `SELECT`, or C1 read endpoints) and mutates only through C1 domain RPCs. The tables each screen touches, and the write path:

| Screen | Reads (RLS `SELECT`) | Writes (via C1 RPC — capability) |
|---|---|---|
| Overview | `budget_node_status` view, `inference_calls` (agg), `provider_health`, `alert_events`, `devices` | — |
| Requests & audit | `inference_calls`, `execution_traces`, `audit_events`, `messages`/`message_citations`, `budget_requests` | `/rpc/budgets/approve-request`\|`/deny-request` (`budget.approve`/`budget.write`) |
| Organization — people | `core.profile_tenants`, `profile_roles`, `core.tenants`, `tenant_domains` | `/members/invite` (`member.manage`), `/rbac/assignments` (`role.manage`) |
| Organization — matrix | `roles`, `role_permissions`, `core.capabilities` | `/rbac/roles` POST/PATCH/DELETE, `/rbac/assignments` (`role.manage`) |
| Organization — budget tree | `budget_nodes`, `budget_node_status` | `/rpc/budgets/upsert-node`\|`/delete-node` (`budget.write`) |
| Organization — API keys | `api_keys` (prefix/metadata only), `service_accounts` | `/rpc/apikeys/create`\|`/rotate`\|`/revoke`, `/rpc/service-accounts/create` (`apikey.manage`) |
| Onboarding | `core.tenants`, `tenant_domains`, connection/budget/space setup state | `/tenants/domains` (`tenant.manage`) + the target RPCs of each step; SSO/SCIM step **stubbed** (F2 §6.6) |
| Models | `config.models`/`model_endpoints`/`model_capabilities`/`providers`, catalog **override** tables (RW10) | `/rpc/models/enable`\|`/set-pricing` (`model.manage`) |
| Routing | `fallback_chains`, `fallback_chain_models` (+`plane`), `chain_bindings`, `routing_policies`, `provider_health` | `/v1/routing/chains` POST/PATCH, `/steps` PUT, DELETE, `/bindings` PUT, `/policy/{id}` PUT (`chain.write`); `/v1/routing/simulate` (`chain.read`) |
| Connections | `router_credentials` (**masked**: label/type/status/expiry/scopes, **no ciphertext, no token**), `config.routers` | `/rpc/connections/upsert`\|`/rotate`\|`/revoke`\|`/oauth-start`\|`/oauth-callback` (`connection.manage`) |
| Governance | `settings`, `feature_states`, `documents.classification` (agg), governance policy tables | `/v1/governance/policy/masking`\|`/classification`\|`/grounded-only`, `/documents/{id}/declassify` (`governance.manage`/`doc.declassify`) |
| Budgets & billing | `budget_nodes`, `budget_node_status`, `inference_calls` (agg), `alert_events` | read-only tree (mirror of Organization); increase approvals via Requests |
| Spaces & KB | `spaces`, `space_members`, per-space `settings` (retrieval/chunking/embedding), `datasets`/`dataset_columns` (§3c policy) | `/rpc/spaces/create`\|`/update`\|`/add-member`\|`/remove-member` (`space.manage`/`member.manage`); C5 space-config RPC; dataset column-sensitivity (`dataset.manage`) |
| Tools & MCP | `mcp_servers`, `tenant_mcp_servers`, `tool_allow_lists` | `/rpc/mcp/register-server`\|`/enable`\|`/set-allow-list` (`mcp.manage`) |
| Feature management | `feature_states` (`tenant_id`+4-state), `modules`/`features`, `spaces`, `roles` | `/v1/governance/feature/{feature}` (`feature.manage`) |
| Device fleet | `devices` (status/last_seen/app+config version/buffer_health) | `/devices/{id}/revoke` (`device.manage`), per-device sync policy (O3) |
| Alerts | `alert_rules`, `notification_channels`, `alert_events` | C1 RPC for alert-rule/channel CRUD (`governance.manage`, coordinate with C3/O3) |
| Prompt library | `prompt_templates` | `/rpc/templates/*` (`template.manage`) |
| Settings | `settings` (workspace scope), `feature_states` | `/v1/governance/policy/*` + `/v1/governance/feature/*` (`governance.manage`/`feature.manage`) |

> **`router_credentials` is never SELECT-able by the browser** (F3 RLS deny-all; §2 W4). The Connections screen reads a **masked projection** exposed by a C1 read endpoint (label, `type`, `status`, `expires_at`, `scopes`, `provider_account_label`, `refresh_status`, `last_used_at`) — no `encrypted_*` columns, ever. Likewise `api_keys` SELECT returns prefix + metadata only (no `hashed_secret`, no budget column).

---

## 4. Contracts

W1 is a browser SPA/SSR app. Its "contracts" are (a) the **route/screen map**, (b) the **data-access layer** that binds each screen to the already-specced server endpoints (C1/C2/C4/F2/F3/C3/C5), and (c) the shell/UX invariants. It introduces **no new server endpoints**.

### 4.1 Route map (SvelteKit routes under `admin.torii…`)

Mirrors the mockup `NAV` groups, extended with the ratified new screens. `[cap]` = the capability that gates the screen's edit affordances (view is broader, RLS-scoped).

```
/                         → Overview                       (dashboard: KPIs, health, alerts)
/requests                 → Requests & audit               [audit.read / analytics.read]
/organization             → Organization (tabbed):
  /organization/people      people ↔ teams ↔ tenant        [member.manage]
  /organization/roles       permission matrix              [role.manage]
  /organization/budget      the single budget tree         [budget.write]
  /organization/api-keys    API keys & service accounts    [apikey.manage]
/onboarding               → Onboarding checklist (SSO step stubbed)  [tenant.manage]
/models                   → Models catalog + overrides + pricing     [model.manage]
/routing                  → Chain editor + bindings + policy + simulator  [chain.write]
/connections              → Connections (OAuth + paste-key, masked)  [connection.manage]
/governance               → Masking/retention/redaction-DLP + classification relabel  [governance.manage]
/billing                  → Budgets & billing (read-only tree + invoices/licence)  [budget.read]
/spaces                   → Spaces & knowledge base                  [space.manage]
/tools                    → Tools & MCP registry + allow-list matrix  [mcp.manage]
/features                 → Feature management (4-state matrix)       [feature.manage]
/devices                  → Device fleet                              [device.manage]
/alerts                   → Alerts & notifications                    [governance.manage]
/templates                → Prompt / template library                 [template.manage]
/settings                 → Workspace defaults                        [governance.manage]
```

### 4.2 Data-access layer (typed client, shared across screens)

A single module owns auth + transport so no screen hand-rolls a fetch:

```ts
// lib/api.ts — the only place that talks to the server.
// - Attaches the Supabase browser-session JWT (RS256) as `Authorization: Bearer`.
// - Reads: PostgREST (supabase-js) under RLS, OR a C1 GET endpoint for masked/derived data.
// - Writes: POST to C1 `/rpc/*` or `/v1/*` domain RPCs ONLY.

export const rpc = {
  budgets:     { upsertNode, deleteNode, approveRequest, denyRequest },     // C3/C1 §4.2
  roles:       { upsert, remove, assign, unassign },                        // F2 /rbac
  members:     { invite },                                                  // F2 /members
  chains:      { upsert, patch, setSteps, remove, setBinding, setPolicy, simulate }, // C2 §4.2
  connections: { upsert, rotate, revoke, oauthStart, oauthCallback },       // F3/C1 §4.2
  governance:  { setMasking, relabelClassification, setGroundedOnly, setFeature, declassify }, // C4 §4.4
  spaces:      { create, update, addMember, removeMember, setConfig },      // C5/C1 §4.2
  mcp:         { registerServer, enable, setAllowList },                    // X1/C1 §4.2
  apikeys:     { create, rotate, revoke, createServiceAccount },            // C1 §4.2 (reveal-once)
  models:      { enable, setPricing },                                      // C1 §4.2 (RW10)
  templates:   { upsert, remove },                                          // C1 (template.manage)
  devices:     { revoke, setSyncPolicy },                                   // F2/O3
};

export const read = { /* thin RLS-scoped SELECT wrappers + masked C1 GETs */ };
```

Every write returns the server's canonical row (or the reveal-once secret, once, for `apikeys.create`) and any `audit_events` id; W1 refreshes optimistic state from the response, never from local assumptions. A 403 is surfaced as a "you don't have permission" toast (not a silent no-op), a 402 (`budget_exceeded`) and 409 (stale config) each get typed handling.

### 4.3 Screen contracts (what each new/edited screen renders + calls)

- **Overview** — KPI tiles (spend vs budget from `budget_node_status`, calls, top models, redactions), `provider_health` list, recent `alert_events`, device-fleet summary. Read-only. Drop the hardcoded "gateway v2.4" footer label (mockup-review #44).
- **Requests & audit** (#17, #40) — table over `inference_calls`+`execution_traces` with **execution-location + device columns** (driven by per-step `plane`, GH-1), filters (space/task/outcome/date), the **why-this-model** trace panel (C4 `WhyThisModelTrace`), the **budget-increase approval queue** (`budget_requests` → approve/deny), and the redaction "what was redacted" panel (#36 — types/counts only, never raw text).
- **Organization / people** — directory (`profile_tenants` + `profile_roles`), invite (`/members/invite`), team placement in the org tree. IdP/SCIM directory import rendered **designed-but-stubbed** (mockup-review #47).
- **Organization / roles (permission matrix)** (#3) — a **role × capability** grid over F2's canonical capability set (§4.3 of F2) and the seeded system roles (§4.2 of F2). Create/edit custom roles (subset-guard enforced server-side, F2 §5.4); assign roles (`/rbac/assignments`, bumps target `claims_version`). Reconciles the three mockup vocabularies into this one model.
- **Organization / budget tree** (#15, #28) — the **single editable** org→dept→team→user tree; per node: `cap_amount`, `period` (D/W/M), `enforcement` (hard/soft) with the **soft-node visual** (bounded overshoot + alert, not "hard limits"), `alert_threshold`, `free_floor_enabled`. `service_account` leaves shown as `kind='service'`. Writes via `/rpc/budgets/*`.
- **Organization / API keys** (#2) — issue key (**reveal-once**: the secret shows exactly once, from the create response, then only prefix/metadata), scope/capabilities (∩ the identity's caps), rate-limit, rotate, revoke, last-used, status; service accounts as first-class identities. **No per-key budget field** — a note shows the key's spend rolls up to its *identity's* budget node.
- **Onboarding** — org identity → SSO (stubbed) → residency → connect router (→ Connections flow) → budgets → invite; add device-rollout + KB-setup steps (mockup-review open Q). Each step deep-links to its owning screen's RPC.
- **Models** (#13) — catalog view + add/edit custom model & endpoint (`api_model_id`, pricing, context, capabilities), enable/disable **per tenant/space/role** (override tables, RW10), mark **local-capable** + device availability, pull/refresh, "verified" state. Writes via `/rpc/models/*`.
- **Routing** (#12, #29, #49, #50) — **chain editor**: create/reorder steps, per-step model/router, **per-step plane (local/cloud)** selector (not inferred from `route==='Ollama'`), multiple named chains per capability, **per-space/role binding** (`chain_bindings`), editable **`routing_policies`** (retry/timeout/region-pin/health — operator config, not baked constants), and the read-only **simulator** (`/v1/routing/simulate`) showing served-by reason + candidates/skips + plane. Triggers limited to the **5 engine `FallbackTrigger`s** (C2 §8.5).
- **Connections** (#11) — per router: **OAuth connect (Anthropic v1)** via `/rpc/connections/oauth-start`→`oauth-callback`, **and paste-a-key**; validate → store (crypto in F3); rotate/revoke; **masked-only** display (label, type, status, expiry, scopes, `refresh_status`, last-used); per-router scope (which spaces/roles); device-local-vs-server custody toggle. Never renders ciphertext or a token.
- **Governance** (#14, #36, #37) — classification **relabel** (fixed 4 levels, display-name only), masking-policy editor (**PII + secrets/credentials** = the redaction-DLP config: enabled detectors, min-confidence, safe-term allow-list), grounded-only mode (off/annotate/block), retention editor + legal hold + export/erase (DSR), assign owners to unowned items, and the **redaction-event audit inspector**. Writes via `/v1/governance/*`.
- **Budgets & billing** — the same budget tree **read-only** (mirror of Organization), plus invoices/licence summary. Client-facing metering is read-only (§2 W2). External billing (Stripe) is **not ratified** (C3 §10) — render licence/usage summary, not a payment flow.
- **Spaces & KB** (#4, #33, #35, #52) — all spaces; membership + fixed 4-level classification ACL; per-space **retrieval-mode/chunking/embedding** defaults (feature-governed; member Playground experiments are session-only); storage/quota, re-index, orphan/dup cleanup; **column-level sensitivity** + allowed-operations (aggregate-only/k-anon threshold) policy for §3c datasets.
- **Tools & MCP** (#1) — register `mcp_servers` (transport `stdio` desktop / `http`·`sse` shared; url/command; scope platform\|tenant; enable) and the **per-(role × space) tool allow-list** matrix; show resolved allow-list state (granted / blocked-by-policy). Enforcement is server-side at tool-call time (X1); W1 only edits the registry/allow-list.
- **Feature management** (#5) — the **4-state** matrix (`locked`/`default-on`/`default-off`/`user-overridable`) per feature × role × space; precedence **workspace→space→role→user**; preview the effective resolution. Writes via `/v1/governance/feature/{feature}`.
- **Device fleet** (#6, #48) — enrolled `devices`, last-seen, app/config version, offline-buffer health, **revoke device** (kills hot-path access — F2 §5.7), per-device sync policy.
- **Alerts** (#7) — `notification_channels` (email/Slack/webhook/SIEM) + `alert_rules` (budget breach, outage, policy hit, anomaly); `alert_events` history + dispatch status.
- **Prompt library** (#8) — shared, versioned, per-space `prompt_templates` for Ask "Draft" and saved workflows.
- **Settings** — workspace defaults (the mockup toggles), re-expressed as governed `settings`/`feature_states`; drop the "gateway v2.4 · daemon running" footer copy.

### 4.4 Cross-cutting shell contracts (every relevant screen)

- **Execution-location badge** — "ran on your device" vs "via gateway · <region>", driven by the per-step **`plane`** column / `inference_calls.execution_location` (GH-1), never by provider name (mockup-review #49).
- **Offline / degraded / sync state** — offline banner, sync chip ("synced · config vN", "N calls queued"), config-version drift (mockup-review #39). Admin is web-first, but the shell affordances are shared with the desktop member console.
- **Locked-toggle visual** — a governed control the caller cannot override (from `resolve_feature` → `locked=true`) renders greyed + lock icon + tooltip (mockup-review #13 ground rules).
- **Redaction indicator** — an unobtrusive "N items redacted" chip with a safe reveal for authorized roles (mockup-review #27) wherever answers/traces appear in the admin (Requests trace).

### 4.5 Events consumed (Supabase Realtime, RLS-scoped)

W1 subscribes to RLS-scoped Realtime channels to keep the UI live without polling:
- `chain.config.changed` / `provider.health.changed` (C2 §4.6) → refresh Routing + health.
- `budget.alert` / `budget.overshoot` / `alert_events` (C3) → Overview + Alerts.
- `devices` status change (F2 §5.7) → Device fleet.
- `feature_states` change → Feature management + re-resolve locked toggles.

---

## 5. Security & RLS

W1 is **not a trust boundary** — it is a convenience layer over server-enforced authz. The build gate:

- **Server is the sole authority (§2 W1).** W1 gates control visibility by the caller's resolved capabilities **for UX only**. Every mutation still hits a C1 `/rpc/*` handler that runs `require(ctx, cap)` server-side; a W1 bug that shows a forbidden control results in a 403, never an unauthorized write. **No direct PostgREST write to a privileged table** is ever issued by W1 (they are `service_role`-write-only in F1).
- **Capability resolution.** W1 does **not** read `role_permissions` to compute its own truth; it reads the caller's effective capability set from a C1 read endpoint (`GET /v1/whoami` → `capabilities[]`, C1 §4.1) — the same server-side resolution used for authz — so the UI and the enforcement agree. Capabilities are **not** in the JWT (F2 §4.1); W1 must not infer them from `role_ids`.
- **Tenant isolation.** All reads are RLS-scoped by the JWT `tenant_id`; W1 never sends a tenant/role in a request body. Cross-tenant data cannot render because RLS returns 0 rows and C1 re-scopes from the verified credential. A tenant-switch (multi-tenant admin) re-mints the token (F2 §8.5).
- **Secrets are masked-only.** `router_credentials` ciphertext/tokens are **never** fetched (F3 RLS deny-all); Connections shows the masked projection only. `api_keys` secrets appear **exactly once** in the `apikeys.create` response (reveal-once) and are never re-fetchable; W1 must not persist the revealed secret anywhere (no localStorage, no query cache) — it is copied to clipboard by explicit user action and dropped from memory on modal close.
- **Redaction / no raw leak (§2 W5).** Where W1 renders governance traces or the "what was redacted" panel, it displays **types + counts + confidence** only — never raw matched secret/PII text or span offsets (C4 `GuardResult` already omits them from the wire shape). The redaction indicator's "safe reveal" is itself capability-gated and, in v1, reveals only the placeholder taxonomy (one-way; no reversible store).
- **Auth session.** W1 holds a Supabase **browser session** (RS256 JWT); it attaches the bearer to every C1 call. Session/refresh is handled by supabase-js; a `token_stale` 401 (claims changed, F2 §4.1.1) triggers a silent refresh then retry. Sign-in supports email + Google/GitHub (SAML shown stubbed) — mockup-review #46/#47.
- **CSP / origin.** The app is served from `admin.torii…` (Cloudflare Pages); C1 is at `api.…` — CORS is restricted to the admin + console origins; no third-party script may read the session.
- **Negative-test alignment.** W1's own tests assert that a control hidden for a capability-less caller, when its RPC is invoked directly (bypassing the UI), returns 403 from C1 — i.e. the UI gate is never the only gate. This piggybacks on the F1 RW12 / C1 §5 adversarial harness.

---

## 6. Key flows

1. **Sign-in → capability-scoped shell.** Admin authenticates (email or Google/GitHub OAuth, F2). W1 loads `GET /v1/whoami` → `{ tenant_id, identity, capabilities[] }`; the nav + per-screen edit affordances render from `capabilities`; screens the caller can't edit still render read-only where RLS permits.
2. **Edit a budget node (Organization → budget tree).** Admin edits a node's cap/period/hard-soft/threshold/free-floor → W1 calls `rpc.budgets.upsertNode(...)` → C1 `require(budget.write)` → writes `budget_nodes` as `service_role` → returns the row + emits `audit_events`. W1 refreshes the subtree from `budget_node_status`; a Realtime tick updates other open admins.
3. **Approve a budget-increase request (Requests queue).** Member's `budget_requests` row appears in the approval queue → admin approves → `rpc.budgets.approveRequest` → C1 `require(budget.approve/write)` → applies to `budget_nodes.cap_amount` → the tree + the member's chip (W2) update.
4. **Issue an API key (Organization → API keys).** Admin creates a key for a person or service account → `rpc.apikeys.create` → C1 returns `{ prefix, secret, identity }` **once** → W1 shows the reveal-once modal (copy-to-clipboard, warning it won't be shown again) → on close, the secret is dropped; subsequent reads show prefix/metadata only. No budget field is offered.
5. **Edit a routing chain (Routing).** Admin adds/reorders steps, sets per-step **plane**, binds the chain to a (space×role) → W1 validates against the 5 triggers + model↔capability locally for fast feedback, then `rpc.chains.setSteps`/`setBinding`/`setPolicy` → C1 `require(chain.write)` validates authoritatively, writes `service_role`, fires `chain.config.changed`. W1 re-runs `rpc.chains.simulate` and re-renders served-by/candidates/skips with plane badges.
6. **Connect a provider (Connections).** *OAuth (Anthropic):* admin clicks Connect → `rpc.connections.oauthStart` → redirect to the provider consent → callback → `rpc.connections.oauthCallback` → F3 stores the encrypted access+refresh tokens; W1 shows the masked account (label/scopes/expiry/refresh_status). *Paste-key:* admin pastes a BYOK secret → `rpc.connections.upsert` (type `api_key`) → F3 encrypts. Rotate/revoke follow the same masked pattern. W1 never sees ciphertext.
7. **Edit governance / DLP (Governance).** Admin edits masking (detectors, min-confidence, safe-terms), retention, grounded-only mode, or relabels a classification display name → `rpc.governance.*` → C1 `require(governance.manage)` → writes `settings` → C4 emits an audit config-change row. A classification **set** change (add/remove level) is rejected by the server; W1 disables that affordance.
8. **Set a 4-state feature (Feature management).** Admin sets a feature's state at workspace/space/role scope → `rpc.governance.setFeature` → `require(feature.manage)`. W1 previews the effective resolution (workspace→space→role→user) and shows which lower layers become `locked`.
9. **Revoke a device (Device fleet).** Admin revokes a device → `rpc.devices.revoke` (`require(device.manage)`) → `devices.status='revoked'`; the F2 hot-path gate rejects that device's next call within the cache TTL. W1 reflects the status via Realtime.
10. **Register an MCP server + allow-list (Tools & MCP).** Admin registers a server and edits the per-(role×space) allow-list → `rpc.mcp.*` (`require(mcp.manage)`). W1 shows resolved granted/blocked state; enforcement (SSRF-filter/sandbox at tool-call time) is X1's, server-side.
11. **Configure a space (Spaces & KB).** Admin sets per-space retrieval/chunking/embedding defaults + column-sensitivity policy → C5 space-config RPC (`require(space.manage)`/`dataset.manage`). Members' Playground experiments remain session-only (not promoted) unless the admin promotes a default.

---

## 7. Gateway-crate dependencies

W1 is a web client and links **no `sensei-*` crate directly** — it consumes the crate's effects only through C1/C2/C4 HTTP. It nonetheless **surfaces** several crate enhancements, so its screens are sequenced after the issues land ([`../plans/gateway-issues.md`](../plans/gateway-issues.md)):

| Issue | How W1 surfaces it | Sequencing |
|---|---|---|
| **GH-1** (per-step `plane` + execution-location on trace) | Routing per-step plane selector + simulator badges, Requests exec-location column, the why-this-model plane badge. Until GH-1 lands, plane renders `unknown` (C4 §4.3). | Routing/Requests screens after GH-1. |
| **GH-2** (OAuth bearer in `sensei-cloud-providers`) | Connections OAuth-connect (Anthropic) flow; the masked `refresh_status`/expiry. Paste-key works without it. | OAuth-connect after GH-2 (paste-key ships earlier). |
| **GH-6** (stream redaction hook) | The redaction indicator + "what was redacted" panel on any streamed admin surface (Requests trace preview). | Non-blocking (C4 ships the windowed transform for v1). |
| **GH-7** (MCP/tool-calling) | Tools & MCP allow-list resolved state depends on X1's enforcement path. | Tools & MCP after X1 resolves GH-7. |
| **GH-8** (`RerankModel`) | Models/Spaces "rerank model" picker; rerank runs as a C5 service in v1. | Non-blocking for W1. |

W1 **files no new gateway issue.** Its only hard build blocker is **W4** (Rokkit named-token map + dark skin — mockup-review #42), not a crate change.

---

## 8. Decisions resolved

Settling W1's residual builder questions (W1 seed §Open questions) per the RESOLVED DEFAULTS:

1. **Permission-matrix cell granularity = F2's canonical capability set, verbatim.** The matrix columns are exactly `core.capabilities` (F2 §4.3); rows are the seeded system roles + tenant custom roles. W1 defines **no** new capability and no sub-cell granularity — a cell is a boolean grant. *Rationale:* F2 owns and freezes the capability enumeration for v1; a W1-invented granularity would drift from the ~10 consuming modules.
2. **Role narrowing vs. space/user layers: RBAC is union-of-roles; space/user layering applies only to feature governance.** Effective **capabilities** = the union across a user's assigned roles (F2 §4.1), tenant-wide — capabilities are **not** narrowed per space. The **workspace→space→role→user** precedence is the **4-state feature** model (C4 §4.2), rendered on the Feature management screen — a separate axis from the capability matrix. *Rationale:* F2 §3.3 — roles (capabilities) are orthogonal to the org tree; conflating them into a per-space capability matrix would contradict F2.
3. **W1 authenticates to C1 with the caller's own Supabase JWT (no service identity).** The admin app is a public client; it holds a browser session and bearer-attaches the user's RS256 JWT to every `/rpc/*` call, which C1 verifies + capability-checks server-side. W1 holds **no** `service_role` key and no privileged credential. *Rationale:* §2 W1 + C1 D7 (authz inline in C1); putting a service credential in a browser app would be the exact hole the posture closes.
4. **Reads use PostgREST/RLS directly; only masked/derived reads go through a C1 GET.** Plain tenant-scoped SELECTs (roles list, budget tree, chains, spaces, devices, alerts) use supabase-js under RLS; `router_credentials`, `api_keys` secrets, and the resolved capability set are **C1 read endpoints** (masked / server-resolved). *Rationale:* RLS already isolates reads; only the deny-all secret tables + server-resolved capabilities need the gateway.
5. **The four read-only editors all become editable in v1** (Connections/Routing/Models/Governance), each via its owning module's RPC. *Rationale:* DECISIONS §6.
6. **API keys + service accounts live on Organization, not Billing; no per-key budget.** *Rationale:* DECISIONS §1(#2)/§2 W2.
7. **The budget tree has one editable home (Organization); Billing renders it read-only.** *Rationale:* DECISIONS §6 / mockup-review #15 — three divergent trees collapse to one.
8. **SSO/SCIM steps render designed-but-stubbed; v1 auth = email + Google/GitHub.** *Rationale:* DECISIONS §3 / F2 §8(1) / mockup-review #46/#47.
9. **Classification is relabel-only (fixed 4 levels).** The Governance editor disables add/remove of levels; the server rejects it too. *Rationale:* DECISIONS §4 / C4 §8(6).
10. **Local models `[desktop]` and Compare are NOT admin-portal screens.** Local-models management is a desktop/member surface (D2/W2), Compare is a Playground control (W3) — W1 does not host them. *Rationale:* mockup-review #9/#10 place them on the member/desktop plane; the brief's admin screen list omits them.
11. **External billing (Stripe) is out of v1 scope for W1.** Budgets & billing shows a licence/usage summary, not a payment flow. *Rationale:* C3 §10 marks external billing as not-ratified.

---

## 9. Acceptance criteria (observable, testable)

1. **Capability-gated shell.** A caller with only `budget.read` sees the budget tree **read-only** (no save controls) and no Roles/Connections/Governance edit affordances; a caller with `budget.write` sees the editable tree. Hiding is cosmetic — see #2.
2. **Server is authority.** Invoking any edit RPC directly (dev tools / script) as a caller lacking the capability returns **403** and writes no row; the corresponding hidden UI control never produces a successful write. (Rides the C1 §5 / F1 RW12 harness.)
3. **No direct privileged write.** A network trace of any W1 mutation shows a POST to a C1 `/rpc/*` or `/v1/*` endpoint — **never** a PostgREST `PATCH/POST/DELETE` against a privileged table (`budget_nodes`, `roles`, `fallback_chains`, `router_credentials`, `settings`, `feature_states`, `spaces`, `mcp_servers`, `api_keys`, catalog overrides).
4. **Reveal-once API key.** Creating a key shows the secret exactly once (from the create response); reloading the screen or re-reading the key shows prefix + metadata only, no secret; the secret is absent from localStorage/query cache after the modal closes.
5. **No per-key budget.** The API-key create/edit form has **no** budget field; a tooltip states spend rolls up to the identity's budget node.
6. **Masked connections.** The Connections screen renders label/type/status/expiry/scopes/refresh-status only; no request ever fetches `encrypted_*`/token columns (asserted against the network log); OAuth-connect (Anthropic) and paste-key both reach the masked "connected" state.
7. **Single budget tree.** Editing a node on Organization is reflected read-only on Budgets & billing (same node ids/caps); soft nodes render the bounded-overshoot visual, not "hard limit"; period/threshold/free-floor are all editable per node.
8. **Permission matrix = F2 set.** The matrix columns equal `core.capabilities` exactly (count + keys); creating a custom role granting a capability the admin lacks is rejected (server subset-guard) and the UI surfaces the 403.
9. **Editable routing.** The chain editor persists reordered steps + per-step plane + a (space×role) binding + a `routing_policies` edit; the simulator re-renders served-by/candidates/skips with plane badges; only the 5 engine triggers are selectable.
10. **Per-step plane, not provider.** A local step renders the "on device" badge from the `plane` column even when its router is not Ollama (regression guard for mockup-review #49); once GH-1 lands, the Requests exec-location column matches the trace.
11. **Governance / DLP editable.** Masking (detectors + min-confidence + safe-terms), retention, grounded-only mode, and classification **display-label** relabel all persist via `/v1/governance/*`; an attempt to add/remove a classification level is disabled in UI and rejected by the server.
12. **4-state feature governance.** Setting a feature `locked` at workspace scope makes the effective preview show `locked=true` for lower scopes; a `user-overridable` feature shows the user layer applies last; the locked-toggle visual renders.
13. **Device revoke.** Revoking a device flips its fleet status (via Realtime) and the F2 hot-path rejects that device's next inference within the cache TTL.
14. **Redaction hygiene.** The Requests "what was redacted" panel shows types/counts/confidence only — no raw secret/PII text or offsets appear in the DOM or network payload.
15. **Tenant isolation.** A tenant-A admin session renders only tenant-A rows on every screen; no request carries a tenant id in the body; a forged tenant id changes nothing (RLS + C1 re-scope).
16. **Stubbed SSO.** The Onboarding + Organization SSO/SCIM steps render as "designed — available in v1.x", non-functional; email + Google/GitHub sign-in works.
17. **Cosmetic reconciliation.** The hardcoded "gateway v2.4 / daemon running" footer strings are gone; version is not user-facing.
18. **Realtime freshness.** A chain/budget/feature/device change made in one admin session appears in another open session without a manual refresh.

---

## 10. Open questions (genuine)

1. **Tenant-switch UX for multi-tenant admins.** F2 (§10.1) supports one active tenant per token but leaves *where* the switcher lives undecided (a header switcher in W1 vs. sub-domain per tenant). W1 needs the placement before building the shell header; default assumption is a header switcher that re-mints the token. Does not block single-tenant admins.
2. **Alerts CRUD ownership.** `alert_rules`/`notification_channels` are C3-owned tables but the mockup places the editor in W1; which capability gates channel/rule edits (`governance.manage` vs a new `alert.manage`) and which C1 RPC serves them needs confirming with C3/O3 — F2's capability set has no `alert.manage` today (would require an F2 edit, §7 of F2).
3. **Per-device sync-policy surface.** Device fleet's "per-device sync policy" (mockup-review #6) depends on the O3 config-sync model, which has no spec yet; the exact policy knobs (allowed planes, buffer limits) are TBD with O3/D4.
4. **Onboarding step orchestration.** Whether onboarding is a linear wizard with server-persisted step state (a new `onboarding_state` per tenant) or a checklist that just deep-links into each screen; persisting resumable state would need a small F1 addition not yet in the rework plan.
5. **Licence/usage summary source.** Budgets & billing shows a licence/usage summary but external billing is unratified (C3 §10); what "licence" means (seat count vs. plan tier) and where it's stored is undecided pending the billing decision.
