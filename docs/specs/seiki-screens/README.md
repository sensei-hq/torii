# Seiki screens — build-vs-mock audit

> **What this is:** a screen-by-screen functional audit of the **Seiki admin web app**
> (`apps/admin`, SvelteKit) against its React mockup, in the style of
> `sensei/docs/spec/dojo-screens/README.md` — every screen traced to a real data source and
> marked MISSING / STUB / PARTIAL / DONE. Complements the *visual* pass in
> [`../../design/fidelity-audit.md`](../../design/fidelity-audit.md) (grid/tokens/pixel) — this one
> is about **what data is wired vs faked**. Audited 2026-07-29.

## Method
- **Mockup** = React IIFE views in `docs/mockups/app/view-*.jsx`, mounted by `docs/mockups/Seiki.html`;
  fixtures in `docs/mockups/app/data.jsx` (`window.StrategosData`), atoms in `atoms.jsx`. Product
  intent: `docs/mockups/CLAUDE.md`.
- **Built** = `apps/admin/src/routes/(app)/*/+page.svelte` (+ `onboarding`, `signin`, `auth/callback`).
- **Data trace** = client calls in `apps/admin/src/lib/api.ts` → gateway endpoints in
  `services/gateway/src/routes/*.rs` (`ledger.rs` reads, `rpc.rs` writes) → real DB tables.
- **Rubric:** **MISSING** (no built route) · **STUB** (chrome only, fixture/empty) ·
  **PARTIAL** (some fields real, others fixture/absent) · **DONE** (fully wired, matches the mock).

## The one big finding
**Every *built* Seiki screen reads REAL gateway/DB data — there are almost no fixtures in the app**
(unlike the mockup, which is 100% `data.jsx`). Several screens *exceed* the mock: Organization has a
real, server-enforced RBAC write path; Connections runs on the real `sensei-vault` (BYOK + OAuth);
Settings actually persists. So the gap is **not "wire up fake screens"** — it is two things:

1. **Breadth — 5 mock screens have no home.** `Spaces & KB` and `Templates` are fully MISSING (no
   route, no nav, no endpoint). `API keys`, `Alerts`, and `Features` exist only as fragments buried
   inside other screens, not reachable from the nav.
2. **Depth — most built screens ship the *primary* slice and omit the mock's management/intelligence
   layers.** Real data, shallow surface: budget-tree editing, routing policy/health, model authoring,
   Governance's ~10 other cards, Overview's insight/alerting, Requests' "why this model" trace.

Plus **one correctness gap that isn't cosmetic:** Tools & MCP stores tool allow-lists but the
inference path (`chat.rs`) never consults them — grants are **stored-but-not-enforced** (the screen's
"Enforced server-side" label is aspirational). That's a security-relevant item, not just missing UI.

## Status (18 screens)

| Screen | Zone | Status | Core gap |
|---|---|---|---|
| Overview | Overview | PARTIAL | real ledger stats; missing hero-insight, alerts, exec-plane split, setup spine, cost-trend |
| Requests & audit | Overview | PARTIAL | real request+audit tables; no "why this model" trace, exception triage, member budget cascade |
| Organization | Tenant | PARTIAL | RBAC real + writable (exceeds mock); no budget tree, people→teams, IdP/SCIM |
| Onboarding | Tenant | PARTIAL | real create-org (M1); mock's 8-step provisioning wizard + registered-tenant card unbuilt |
| Devices | Tenant | PARTIAL | real fleet list + revoke; no enroll flow, summary tiles, exec/sync/device-key columns |
| Models | Gateway | PARTIAL | real catalog + enable/disable; no add/edit/refresh, tier/price/quality/latency, per-space scoping |
| Routing | Gateway | PARTIAL | real chains + step enable/disable; no reorder/edit, routing-policy, provider-health, assignments, simulate |
| Connections | Gateway | PARTIAL | real BYOK vault + OAuth + API-identities (exceeds mock); no custom-router, scope, custody, key health/expiry |
| Tools & MCP | Gateway | ⚠ PARTIAL | config CRUD real + persisted **but allow-lists NOT enforced at inference**; no register-server, per-space tightening |
| Spaces & KB | Gateway | **MISSING** | no route/nav/endpoint — only a bare `/rpc/spaces/create` primitive exists |
| Templates | Gateway | **MISSING** | no route, no nav, no endpoint anywhere |
| API keys | Gateway | PARTIAL | "API identities" built *inside* Connections; no dedicated route/nav, no rotate, no spend/rate/budget-node metering |
| Governance | Govern | PARTIAL | only the "Feature governance" card is built + wired; ~10 other mock cards absent (see below) |
| Features | Govern | PARTIAL | = Governance's 4-state control at **workspace scope only**; no space/role scope switcher, grouping, owner/surface metadata |
| Budgets & billing | Govern | PARTIAL | budget tree + increase-requests real + editable; **all billing** (plan/seats/invoices/pricing/cost-breakdown) absent |
| Alerts | Govern | PARTIAL | one on/off toggle in Settings; backend `notification_channels` + SIEM streamer exist but no admin API/UI |
| Settings | Govern | **DONE** | 1:1 with the mock + actually persists (mock is client-only) |
| Signin | Entry | **DONE** | magic-link + password + GitHub OAuth live with real callback routing; cosmetic drift only |

**Tally:** 2 DONE · 14 PARTIAL · 2 MISSING. (All "real" verdicts render empty against the currently-empty
prod DB — the *wiring* is genuine; data lands after `dbd apply && dbd import`.)

## Per-screen detail

### Overview — PARTIAL
Real: `api.requests/budgets/audit/connections` → `ledger.rs` (`get_requests/get_budgets/get_audit/get_connections`), all tenant-scoped SQL over `inference_calls`/`budget_nodes`/`audit_events`/`config.routers`; spend/tokens/local-share/top-models `$derived` live. Missing vs mock: hero savings-insight callout, threshold-driven **alerts** list, **execution-plane split** card (gateway % vs on-device + device-fleet/ingestion links), gateway **setup-coverage spine**, 14-day **cost-trend** sparkline, quick-action cards.

### Requests & audit — PARTIAL
Real: two ledger tables (`get_requests` + `get_audit`) with client-side filtering. Missing: per-call **"why this model" routing trace** (no per-call trace in schema), **fallback-exception** grouping/triage, member-scope **budget cascade** + request-increase flow, CSV export.

### Organization — PARTIAL (exceeds mock on RBAC)
Real + **writable**: members/roles/permission-matrix via `get_org` + real RPCs (`assign-role`/`unassign-role`/`create-role`, `orgs_transfer_ownership`) with server-enforced subset/last-owner guards. Missing: editable **budget-hierarchy tree**, **people→teams** mapping, **IdP/SCIM** directory import (budget data exists at `/v1/budgets` but isn't rendered here).

### Onboarding — PARTIAL
Real: single "create org" form → `rpc.rs orgs_create` (seeds tenant + owner role + budget root) → `refreshSession()`. This is the shipped M1 flow. Missing: the mock's 8-step provisioning **wizard** with inline sub-flows (SSO, residency, connect router, budgets, invites, Torii rollout, Spaces) + **registered-tenant** details card. Only step 1 is effectively covered.

### Devices — PARTIAL
Real: fleet list + revoke → `get_devices` (over `public.devices` + owner join) and `devices/revoke` (cuts device on the auth hot path). Missing: **enroll** flow (Ed25519 + one-time code), 4 summary tiles, and the **exec-location / local-model-count / device-key-fingerprint / sync-buffer** columns (the `Device` type carries none of these fields).

### Models — PARTIAL
Real: catalog + per-tenant enable/disable → `GET /v1/models` (`config.models`+`providers`, `reachable` from `model_endpoints`, `enabled` from `tenant_model_state`) and `setModelEnabled` (`rpc.rs` upsert). Missing: **add/edit** custom model, **"Refresh from routers"**, **tier tabs**, price/quality/latency columns, per-space/role enable-scoping. (Catalog schema has no tier/price/quality/latency fields.)

### Routing — PARTIAL
Real: chains + per-step enable/disable → `get_routing` (`fallback_chains`+`fallback_chain_models`) and `setRoutingStep` (`UPDATE is_active`). Missing: step **reorder/add/edit**, **routing-policy** card (retries/backoff/timeout/region/health-interval), **provider-health**, **chain-assignments** (per space/role), and the **simulate-outage** panel. No backing endpoint for policy/health/assignments.

### Connections — PARTIAL (exceeds mock)
Real, vault-backed: router connect/rotate/revoke + Anthropic **OAuth** + an **API-identities** block, all sealed into the real `sensei-vault` (`PostgresVaultStore` + Supabase-Vault KEK) via `connections_connect`/`connections_oauth_connect`. Missing: **add custom** OpenAI-compatible router, per-router **scope** (spaces/roles), **custody** toggle (on-device vs gateway), key **health/expiry**. (Masked-key preview intentionally dropped — keys are write-only.)

### Tools & MCP — ⚠ PARTIAL (stored-not-enforced)
Real config: server list + tools×roles allow-list matrix → `get_tools` (`mcp_servers`/`tenant_mcp_servers`/`mcp_server_tools`/`tool_allow_lists`) with `mcp_set_enabled`/`mcp_set_tool_grant` writes. **⚠ `chat.rs` has zero MCP references** — allow-lists are persisted but never consulted at inference. Also missing: **Register-server**, per-**space** tightening, url/note/tools-count/exec-badge detail.

### Spaces & KB — MISSING
The admin/space RAG-defaults screen behind Torii's Library/Playground: per-space parser & embedding profile, chunking strategy, retrieval mode (dense/sparse/**hybrid** + rerank + advanced: contextual/ColBERT/RAPTOR/GraphRAG/SQL-RAG/agentic), classification floor/retention/masking policy, storage quota + ingestion health. **No route, no nav, no list endpoint** — only `POST /rpc/spaces/create` (inserts name/classification/owner into `public.spaces`). This is the single largest missing surface and it blocks Torii's whole RAG story.

### Templates — MISSING
A shared, versioned prompt/template library (scoped private/space/tenant) powering Ask's "Draft" and Workflows. **No route, no nav, no `templates` table, no endpoint.**

### API keys — PARTIAL (buried in Connections)
The mock's "API identities" (scoped tenant keys + service accounts, each metered to a budget node, no per-key budget). Built as a card inside `connections/+page.svelte` — issue reveal-once (`issueApiKey`), masked list, revoke. Missing: dedicated **route + nav entry**, per-key **rotate**, per-identity **spend/rate/budget-node** metering, and a scoped "New identity" flow (built issue takes only a name).

### Governance — PARTIAL (1 of ~11 cards)
Built + wired: **Feature governance** only → `get_governance` (`config.features`+`feature_policies`) + `set-feature` 4-state RPC, with 3 summary tiles. Missing (all mock cards): policy-enforcement/blocks feedback loop, **masking-policy editor**, redaction rules, safe-term allow-list, classification scheme, retention/legal-hold, ownership-by-space, effective-policy-per-member, device fleet, audit + SIEM toggle. *(Masking is enforced on the chat hot path — but its editor UI lives only in the mock; the runtime toggle is on Settings.)*

### Features — PARTIAL
Same code as Governance's Feature-governance card (the 4-state locked/on/off/overridable model, real via `set-feature`). Missing: the **scope switcher** (`set-feature` hardcodes `scope_type:'workspace'` though the RPC accepts space/role scopes), section grouping, owner/surface metadata, per-control allowed-state limits, precedence diagram.

### Budgets & billing — PARTIAL
Real + editable: budget **tree** (inline cap edit via `upsert-node`) + pending increase-requests (approve/deny) → `get_budgets` over `budget_nodes`+`budget_requests`. Missing: **all billing** — plan/seats summary, invoices, pricing, provider/model cost breakdown, cap-policy overage table (consistent with "no payment provider"; the mock's invoices/seats are fixtures anyway).

### Settings — DONE
1:1 with the mock's `admin.jsx SettingsView` (masking / autoFallback / alerts / telemetry) and **persists** → `get_settings` (`tenant_settings`) + `set` RPC. Caveat: `alerts`/`telemetry` persist but aren't wired to runtime behavior (masking + autoFallback *are* enforced on the C1 hot path).

### Signin — DONE
Magic-link (primary) + password + **GitHub OAuth**, with a real `auth/callback` that establishes the Supabase session, calls `whoami`, and routes to `/` or `/onboarding`. Cosmetic drift only: Google shown disabled (fast-follow) vs enabled in mock; demo persona-picker dropped for a real form.

## Cross-cutting workstreams (the real shape of the work)

- **WS-A · Surface the 5 homeless screens.** Build `/spaces` + `/templates` (+ their backends);
  promote **API keys** and **Alerts** to real routes with nav entries; expose **Features'** per-scope
  editing. These are the visible "missing from the product" gaps.
- **WS-B · Depth on built screens.** Budget-tree UI on Budgets/Organization (data already exists),
  routing policy/health/assignments + chain editing, model authoring (add/edit/refresh), Governance's
  remaining cards, Overview insight/alerting/exec-plane, Requests routing-trace + exception triage,
  Devices enroll + columns.
- **WS-C · Close the MCP enforcement gap (⚠ security).** Wire `tool_allow_lists` into the inference
  path so stored grants are actually enforced. Today the config is honored by no one.
- **WS-D · Schema gaps that block WS-B.** per-call **routing trace** (also unblocks Torii's
  why-model), model-catalog **tier/price/quality/latency**, **Device** exec/sync/key fields,
  **pricing/invoices**, **IdP/SCIM**, **templates** table, **spaces KB config**, **alert rules**.

## Suggested priority (dependency-aware)
1. **WS-C** MCP enforcement — it's a stored-not-enforced security gap, cheap relative to impact.
2. **WS-D** the trace + catalog schema fields — they unblock the highest-value depth (why-model,
   model authoring) on both products.
3. **Depth on the money/governance path** (WS-B): budget-tree UI → Governance masking/redaction
   editors → Routing policy/health. These are the admin's core job.
4. **WS-A** the homeless screens, in impact order: **Spaces & KB** (unblocks Torii RAG) → API keys
   route → Alerts → Templates.
5. Billing (plan/invoices) last — gated on the payment-provider decision.

## Open questions for Jerry
- **Pre-release scope line:** which of Spaces & KB / Templates / Alerts / full API-keys route are
  in scope pre-v1, and which stay honest-empty? Billing needs a payment-provider decision or an
  explicit "defer".
- **MCP enforcement:** when do we close the stored-not-enforced gap — is it a v1 blocker?
- **Schema builds now vs defer:** per-call routing trace · model tier/price/quality · Device fields ·
  IdP/SCIM · templates · spaces KB config · alert rules.
- **Governance surface:** rebuild all ~10 mock cards, or is "Feature governance + Settings toggles"
  the intended v1 governance scope?

## Related
- Visual/grid pass: [`../../design/fidelity-audit.md`](../../design/fidelity-audit.md)
- Product intent + screen map: [`../../mockups/CLAUDE.md`](../../mockups/CLAUDE.md)
- Torii (desktop) companion audit: [`../torii-screens/README.md`](../torii-screens/README.md)
