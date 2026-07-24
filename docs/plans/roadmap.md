---
title: Strategos — CANONICAL full-cycle v1 roadmap (single dependency graph + phase plan)
description: The one authoritative ordering for all 23 modules (incl. C6), reconciling the three prior graphs (modules/README, per-module depends-on headers, clients-buildout §8), with F1-rework and the gateway-repo crate issues (GH-1 trace, GH-2 OAuth) sequenced as explicit prerequisites, and human secrets/approvals front-loaded.
type: roadmap
status: authoritative
created: 2026-07-23
supersedes_ordering_in:
  - docs/modules/README.md (Dependencies & build order)
  - docs/design/clients-buildout.md (§8 Build phases)
  - per-module spec "Depends on" headers (where they disagree — see §5)
authority: docs/DECISIONS.md (RATIFIED 2026-07-23)
---

# Strategos — CANONICAL full-cycle v1 roadmap

> **This document is the single authoritative build ordering.** Where the module index graph
> (`modules/README.md`), the per-module spec `Depends on:` headers, and the blueprint
> (`design/clients-buildout.md` §8) disagree, **this roadmap wins** for *sequencing*.
> [`../DECISIONS.md`](../DECISIONS.md) remains the source of truth for *scope/architecture/security*;
> the mockups remain UI ground truth. See §5 for how the three prior graphs were reconciled.

The product is **23 modules** (F1–F3, C1–C6, D1–D4, W1–W5, O1–O3, X1–X2 — C6 is the 23rd, added
per DECISIONS §3b). Build proceeds as a **walking skeleton first** (thin vertical slice on the
built-but-insecure F1 + v0.2.x-era plans), **then a security rebuild** anchored on the **F1
security+scope rework**, then breadth. Two classes of prerequisite are sequenced explicitly:

- **Gateway-repo crate issues** (owned here, filed → implemented → closed → released via the lockstep
  tag bump; see [`gateway-issues.md`](gateway-issues.md)). The two **blocking** ones —
  **GH-1** (per-step `plane`/execution-location on the trace) and **GH-2** (OAuth/bearer
  provider-credential support) — are drawn as nodes in the graph before their dependents.
- **Human secrets/approvals** — front-loaded (§4): Supabase RS256/JWKS + `SUPABASE_JWT_*`,
  paid-provider-call approval, KMS/KEK, and the Anthropic OAuth client.

---

## 1. The one canonical dependency graph (all 23 modules + crate prereqs)

```
 CRATE PREREQS (gateway-repo issues; release via tag bump before the dependent phase)
   GH-1  per-step plane / exec-location on ChainEntry+Attempt+ExecutionTrace  ─┐
   GH-2  OAuth/bearer provider-credential in sensei-cloud-providers  ─┐        │
                                                                      │        │
 FOUNDATIONS                                                          │        │
   F1  data model & schema  (BUILT — insecure)                        │        │
    │                                                                 │        │
    │   ┌───────────────────────── F1-REWORK  (RW1..RW15) ◀ CRITICAL PATH ─────┼──────┐
    │   │   security hardening + role/permission matrix + hard-reserve ledger  │      │
    │   │   + MCP/API-keys + Ask persistence + router_credentials(api_key|oauth,│     │
    │   │   RW13) + routing schema (RW14) + analytics/dataset addenda (RW15)    │      │
    ▼   ▼                                                                       │      │
   F1' (reworked)                                                              │      │
    ├──────────────▶ F2  identity/auth/RBAC  (RS256/JWKS, capabilities, device lifecycle)
    │                   │        ▲                                             │      │
    └──────────────▶ F3  key vault (DEK/KEK envelope; api_key + OAuth accounts) │      │
                        │   depends F1'.RW13 + F2 + GH-2 ◀────────────────────┘      │
                        │   ── BUILD GATE: F3 must precede C1 handling any REAL credential ──
                        ▼                                                              │
 CENTRAL PLANE          C1  gateway service & API  (sole decryptor; JWT verify; GatewayStore)
   (F1'→F2/F3→C1)        │                                                             │
                        ├─▶ C2  routing/chains/resilience  ◀── GH-1 (per-step plane) ──┘
                        │      ⇅ (mutual: C2 budget-filter ⇄ C3 headroom/step-down)
                        ├─▶ C3  budgets/metering/ledger  (hard reserve→commit)  ◀ GH-4/GH-5
                        ├─▶ C4  governance runtime + DLP/redaction (§2 W5)      ◀ GH-6
                        │        │
                        │        ├─▶ C6  quality signals & interaction intelligence
                        │        │        (depends C1,C4; signals contract) ⇅ C5 (retrieval metrics)
                        │        └─▶ O1  request ledger, audit & SIEM  (depends C1,C3,C4,C6)
                        └─▶ C5  RAG & document center  (depends F3,C1,C4,C6, Supabase Storage)
                                   │
 DEVICE PLANE (correct order — README's D-graph was inverted, DECISIONS §7)
   F2 ─▶ D1  desktop shell & local store  (client session, device enrol, keychain)
   D1 ─▶ D2  embedded local gateway (in-process EmbeddedLlamaAdapter; 1024-dim embed chain)
   { C1, C3, O3 } ─▶ D4  config sync & offline  (Realtime + versioned pull + signed buffer)
   { D1, D2, C1, C2, D4 } ─▶ D3  split-plane router  ◀── GH-1 (unified per-step trace)
   { F2, D4 } ─▶ O3  device fleet & feature 4-state governance
 WEB PLANE
   W4  design system  (root of UI stack; BLOCKS W1/W2/W3 builds — mockup-review #42)
    ├─▶ W1  admin portal   (depends F2,F3,C1,C2,C3,C4,C5,O3,X1)
    ├─▶ W2  member console (depends F2,C1,C5,C6; hosts W3; hosted in D1)
    ├─▶ W3  playground     (depends C5,C1,C6,C4,D2)
    └─▶ W5  marketing site (light: token vocab only; own later phase)
 CROSS-CUTTING & OPS
   { C1, C4, W1 } ─▶ X1  tools & MCP  ◀── GH-7 (tool-calling; else consumer-side in C1/C4)
   { C1,C3,C4,C6,O1 } ─▶ O2  analytics & cost insights  ◀ GH-1 (plane split) / GH-5 (attribution)
   { W2, W4 (v1 design) } ─▶ X2  agents & workflows  (DESIGN-ONLY v1; runtime composes C1/C3/C4/C5/C6/X1 in v2)
   F2 ─▶ SSO/SCIM (fast-follow v1.x, alongside W5)
```

**Reading it:** F1-rework is the hinge — everything in the CENTRAL PLANE and the RBAC/vault
foundations rebuild on the reworked schema. GH-1 gates every unified-trace / plane-split consumer
(C2, D3, O1, O2, exec-badges). GH-2 gates F3's OAuth credential path (and thus any real Anthropic
OAuth account). F3 is a hard build gate before C1 touches a real provider credential.

---

## 2. Ordered phase table (canonical)

Legend — **status**: `existing` (plan file already exists, no new file) · `reconcile` (existing plan
needs crate-ref/MIG/GH fixes) · `new` (author a new plan file). Prereqs list prior phases + crate
issues + human inputs (§4).

### Part A — Walking skeleton (thin vertical slice; runs on built F1 + local-dev secrets)

| Phase | Title | Modules | Prerequisites | Scope (one-paragraph) | Observable acceptance gate |
|---|---|---|---|---|---|
| **P0** | Scaffold + design system | W4 (+bun/Cargo workspaces, `packages/core`, Kavach link) | Kavach link decision; **MIG-1** (`Cargo.toml [patch]` still targets nonexistent `gateway`/`gateway-embedded` → repin to `sensei-*` @ v0.4.6) | bun+Cargo workspaces; Zen-Sumi→Rokkit skin/tokens + ~30 atoms + ⌘K palette; swappable mock data layer on the Kavach Supabase adapter. | Both empty apps boot with shared shell chrome + skin; atom preview renders; `cargo check` resolves the repinned `sensei-*` patch. |
| **P1a** | Desktop shell + client-only auth | D1, F2·(client-session subset) | P0; **Supabase project + email/OAuth login**; Kavach client-only session (upstream enhancement) | Tauri shell (title bar, nav rail, `EnvChip`, `DeviceFooter`, ⌘K); Kavach client-only session store + client-side `@kavach/sentry` route guard; Sign-in from `@kavach/ui`. | A user signs in on the desktop SPA (no SvelteKit server), session persists+refreshes, role-guarded routes redirect. |
| **P1b** | Local inference + Ask (skeleton) | D2·(min), W2·(Ask min) | P1a; **MIG-4** (embedded-adapter wording); 1024-dim local embed model pick | Embed `sensei-local-providers` in-process (`EmbeddedLlamaAdapter`, GGUF, no daemon) + `ChainedResolver`; local Ask end-to-end; minimal Local Models screen. | With the network **off**, a user asks a question and gets a grounded local answer with `ExecBadge` "on your device". |
| **P2a** | Central gateway (skeleton) | C1·(cloud passthrough) | P1b; **MIG-1..3** (rewrite adapter reg to v0.4.6 `AdapterRegistry`/capability traits; `InferenceAdapter` deleted); **Supabase RS256/JWKS + `SUPABASE_JWT_*`**; **paid-provider-call approval**; local-dev `STRATEGOS_KEK` + one sanctioned test key | Axum `services/gateway` wrapping `sensei-gateway`; JWT verify; config assembly from Postgres; `GatewayStore`→Postgres; `/v1/{chat,embed,generate,compare}` + SSE. | A cloud chat call routes through C1, verifies a real Supabase RS256 JWT, streams via SSE, and writes one `inference_calls` row. |
| **P2b** | Split-plane (skeleton) | D3·(per-answer plane toggle) | P2a; **GH-1** (per-step `plane` on trace) filed+released; **MIG-4** | Desktop Ask gains a **D3-only per-answer Local/Cloud plane toggle**: Local runs in-process via the embedded engine, Cloud proxies to C1 `/v1/chat` with the Supabase JWT (provider keys never touch the desktop). **Step-by-step chains spanning both planes in one trace + D4 config pull/offline buffer move to P10.** | In one Ask UI the user picks Local or Cloud per answer and the per-answer `ExecBadge` is accurate ("on your device" vs "via gateway"); provider keys stay on C1. |

### Part B — Security rebuild (F1-rework critical path; hardened central plane on reworked schema)

| Phase | Title | Modules | Prerequisites | Scope (one-paragraph) | Observable acceptance gate |
|---|---|---|---|---|---|
| **P3** | **F1 security + scope REWORK** ◀ **CRITICAL PATH** | F1 (RW1–RW15) | P2b (skeleton demoed); dbd workflow | Close all authz holes (gateway-mediated writes RW1); role/permission matrix RW2; MCP+API-keys RW3/RW4; Ask persistence RW5; feature 4-state+prefs RW6; hard-reserve single ledger RW7; audit+alerts RW8; retire group-ACL RW9; catalog overrides+fixes (`similarity_search`→1024) RW10; seed RW11; adversarial harness RW12; `router_credentials` api_key|oauth RW13; routing schema RW14 (C2 prereq); analytics/dataset addenda RW15. | `dbd reset && apply && import` green; `tests/authz.sql` **denies** every adversarial mutation (role self-escalation, self budget-raise, confidential self-join, classification downgrade, audit forgery, anon `feature_states` write) and the hard-cap concurrency race admits ≤ headroom. |
| **P4** | Identity/RBAC + Key vault | F2·(full), F3 | P3; **GH-2** (OAuth/bearer adapter) filed+released; **KMS/KEK provisioned** (prod KEK in cloud KMS/HSM); **Anthropic OAuth client** (client_id/secret, redirect, scopes, token_url) | Full RBAC matrix + capability JWT claim + device lifecycle/`DeviceGuard`; F3 DEK/KEK envelope vault (`router_credentials`); OAuth connect + background refresher for Anthropic accounts; RS256/JWKS verify-only confirmed. | An admin connects a router **two ways** (paste BYOK key / OAuth-connect Anthropic); both encrypt at rest (`service_role`-only, no view/function leaks decrypted material); an OAuth token auto-refreshes before expiry; a capability-gated write is denied without the capability. |
| **P5** | Gateway hardening + Routing + Budgets | C1·(harden), C2, C3 | P4; **GH-1** released; **GH-4** (hard reserve affordance) + **GH-5** (ledger attribution) decided/filed; paid-provider approval reconfirmed | Rebuild C1 to the ratified posture (gateway-mediated `/rpc/*` writes, capability authz); C2 named chains ↔ capability ↔ space/role binding + circuit breaker + per-step `plane`; C3 hard reserve→commit cascade (org→dept→team→user) on the single `inference_calls` ledger + `budget_requests`. **(C2⇄C3 co-developed — see §5.)** | An admin defines a chain and a budget tree; a `hard` node at cap rejects the over-budget call under concurrency (≤ headroom admitted); every privileged write goes through `/rpc/*` (no direct PostgREST write to privileged tables). |
| **P6** | Governance + Ledger/Audit + Quality signals | C4, O1, C6 | P5; **GH-6** (streaming-safe redaction hook) investigated | C4 governance wrapper (guardrails, PII/tenant masking, grounded-only, classification, "why-this-model") + **secret/PII redaction/DLP** (§2 W5) at inference egress; O1 immutable audit + SIEM stream + export; C6 `quality_signals` capture contract + live-meter backing (explicit + implicit incl. LLM-as-judge). | A prompt containing a secret/API-key is redacted before egress to any model; every call emits an audit row (`actor_id`=self or gateway) + a `quality_signals` row keyed to `inference_calls`; the audit ledger streams to a SIEM sink and denies UPDATE/DELETE to `authenticated`. |
| **P7** | RAG + Document center | C5 | P6; **Supabase Storage** buckets; 1024-dim embedding chain (P1b/P4); GH-8 (rerank = C5 service, not crate) | Markdown-first ingestion (PDF/DOCX/PPTX/XLSX/images → md + assets, original kept); dedup(content-hash)+versioning; per-space composable retrieval (BM25 + dense + hybrid fusion, semantic chunking, contextual retrieval, cross-encoder rerank service; GraphRAG/RAPTOR/ColBERT/SQL-RAG selectable); redact-at-rest before embedding (§2 W5); §3c schema-to-LLM/execute-in-app for sensitive datasets (central boundary). | A doc uploads → ingestion pipeline reaches `ready`; a Playground query returns a grounded answer with citations to accessible chunks only; the vector index holds **no raw secrets** (redact-at-rest verified); a sensitive-column dataset answers an aggregate query without the model seeing raw values. |

### Part C — Web breadth, device completion, cross-cutting, ops

| Phase | Title | Modules | Prerequisites | Scope (one-paragraph) | Observable acceptance gate |
|---|---|---|---|---|---|
| **P8** | Admin Portal | W1 | W4 (P0); F2/F3 (P4); C1–C5 (P5–P7); O3 backend (P10 — Feature mgmt/Device fleet stubbed until then) | `apps/admin` shell + all admin screens; read-only mockup editors made **editable** (Connections connect/rotate/revoke, Routing chain editor, Models add/enable/pricing, Governance masking/retention); new surfaces (Tools & MCP, Device fleet, Feature management 4-state, Spaces & KB, Organization API-keys/roles/permission-matrix, Alerts). | An admin connects a router, defines a chain, sets budgets + a governance policy, and issues a reveal-once API key — all via `/rpc/*`; the change is enforced by the gateway on the next call. |
| **P9** | Member Console breadth + Playground | W2·(full), W3 | W4 (P0); C1/C5/C6 (P5–P7); D2 (P1b) | W2 Library (document workspace: collections/tags/versions/lineage/dedup, extracted-asset browser, ingestion status, preview, bulk actions) + Activity (ledger + exec-location + budget cascade + increase-request) + personal Settings; W3 Playground (retrieval-mode selector + hybrid slider + rerank/chunking pickers + inspector + live meters + compare + promote-to-default). | A member browses a versioned doc, runs a Playground query switching retrieval modes with the inspector showing the pipeline + live grounding/quality/cost/latency meters, and promotes a config to the space default. |
| **P10** | Device-plane completion | D2·(full), D4·(full), D3·(full), O3 | P5 (C1/C2/C3); P6 (audit); **GH-1** released | Mature the device plane: D2 full model registry/download/GC + local RAG/embed + §3c local-only compute; D4 versioned config sync (`config_versions`) + Realtime hot-reload + signed idempotent usage/audit buffer; D3 full unified split-plane trace + device-status hot-path check; O3 enrolled-device fleet mgmt + per-feature 4-state governance. | An admin changes a chain in W1 → the desktop picks it up live via Realtime and enforces it; a revoked device with a live JWT is blocked on the C1 hot path; offline usage buffers reconcile idempotently on reconnect (no under-report / replay). |
| **P11** | Tools & MCP | X1 | { C1, C4 } (P5/P6); W1 (P8, admin allow-list UI); **GH-7** (tool-calling) investigated | MCP registry (stdio on device, http/sse shared) + per-(role×space) tool allow-lists; gateway enforces at **tool-call time** (SSRF-filter http/sse, sandbox stdio); tool-egress redaction (§2 W5); `mcp_server_tools` discovery cache. | A tool not in a member's role×space allow-list is absent at resolve time; an http tool call to a private IP is SSRF-blocked; tool inputs/outputs pass W5 redaction before egress. |
| **P12** | Analytics & cost insights | O2 | { C1, C3, C4, C6, O1 } (P5–P6); **GH-1** + **GH-5** released | Cost trends, model mix, **local-vs-cloud savings** (plane-split), fallback rates, per-scope (org→dept→team→user) spend rollups; reconstructable rollup tables/materialized views reconciled against `inference_calls` + `quality_signals`. | `GET /v1/analytics/spend?group_by=team|user` returns per-scope spend without recursive joins; the local-vs-cloud savings dashboard attributes `$0` local vs cloud cost from `execution_location`. |
| **P13** | Agents & workflows (design-only) | X2 | W2/W4 (P0/P9); existing workflows mockups | Ship the Workflows index + agent-builder **screens only**, badged "agent · v2"; **no** runtime tables (`plans`/`planned_tasks`/…). Runtime (ReAct/DAG/HITL, collaborative-doc edits, interaction-intelligence go-between) composes C1/C3/C4/C5/C6/X1 in **v2**. | The Workflows + agent-builder screens render from mock data with the v2 badge; no runtime execution path or runtime tables exist. |

### Part D — Fast-follow (v1.x)

| Phase | Title | Modules | Prerequisites | Scope (one-paragraph) | Observable acceptance gate |
|---|---|---|---|---|---|
| **P14** | Marketing site + SSO/SCIM | W5, F2·(SSO/SCIM) | W4 token vocab (P0); F2 sign-up live (P4); **product decisions**: content model, pricing tiers, funnel/lead routing | W5 public marketing app (separate codebase from `components/*`, zero tenant data) — hero/controls/pricing/talk-to-sales, CTAs land in F2 sign-up or sales; F2 SAML SSO + SCIM provisioning (designed-but-stubbed in v1 onboarding → enabled here). | A visitor hits `/pricing` and a tier CTA routes to a real F2 sign-up or a sales lead; an enterprise tenant completes a SAML SSO login and SCIM provisions/deprovisions a user. |

---

## 3. Existing plan files → canonical phases (reconciliation map)

| Existing file | Canonical phase | Status | Fix required |
|---|---|---|---|
| `phase-0-foundations-plan.md`, `phase-0-prereqs.md` | P0 | **reconcile** | MIG-1: repin `Cargo.toml [patch]` (currently `gateway`/`gateway-embedded` — both wrong) to `sensei-*` @ v0.4.6; crate-name wording. |
| `phase-1a-shell-auth-plan.md` | P1a | **existing** | Auth/shell only — no crate refs; leave as-is. |
| `phase-1b-local-inference-ask-plan.md` | P1b | **reconcile** | MIG-4: `gateway-embedded`/`fastembed`/`InferenceAdapter` → `EmbeddedLlamaAdapter` in `sensei-local-providers` (in-process GGUF, no daemon). |
| `phase-2a-central-gateway-plan.md` | P2a | **reconcile** | MIG-1..3: rewrite adapter registration to v0.4.6 `AdapterRegistry`/capability traits (`InferenceAdapter` deleted); crate version `v0.2.x`→`v0.4.6`; RS256 verify. |
| `phase-2b-split-plane-plan.md` | P2b | **reconcile** | GH-1 (per-step plane on trace) as prereq; crate names for the local wing. |
| `F1-rework-plan.md` | P3 | **existing** | Authoritative rework plan — no change. |
| `F1-data-model-plan.md` | (historical) | **existing** | Superseded by F1-rework for the security/scope deltas; kept for lineage. |
| `gateway-issues.md` | (backlog, all phases) | **existing** | GH-1..8 + MIG-1..4 tracker; issues filed as their dependent phase is scheduled. |
| `phase-3-identity-rbac-keyvault-plan.md` | P4 | **existing** | Identity/RBAC + key vault (F2/F3). |
| `phase-3a-gateway-routing-budgets-plan.md` | P5 | **existing** | Gateway hardening + routing + budgets (C1-harden/C2/C3). |
| `phase-3b-governance-ledger-quality-plan.md` | P6 | **existing** | Governance + ledger/audit + quality signals (C4/O1/C6). |
| `phase-4-rag-document-center-plan.md` | P7 | **existing** | RAG + document center (C5). |
| `phase-4a-admin-portal-plan.md` | P8 | **existing** | Admin portal (W1). |
| `phase-4b-member-console-playground-plan.md` | P9 | **existing** | Member console breadth + Playground (W2/W3). |
| `phase-4c-device-plane-completion-plan.md` | P10 | **existing** | Device-plane completion (D2/D4/D3/O3). |
| `phase-5-tools-mcp-plan.md` | P11 | **existing** | Tools & MCP (X1). |
| `phase-5a-analytics-plan.md` | P12 | **existing** | Analytics & cost insights (O2). |
| `phase-5b-agents-design-only-plan.md` | P13 | **existing** | Agents & workflows, design-only (X2). |
| `phase-6-marketing-sso-scim-plan.md` | P14 | **existing** | Marketing site + SSO/SCIM (W5/F2). |

All Part B/C/D canonical phases now have their plan file (filename → canonical P-number above); no plan files remain to author.

---

## 4. Front-loaded human inputs (secrets / approvals)

Per DECISIONS §3 ("secrets/approvals are front-loaded"), obtain these **before** the phase that first
needs them so autonomous build is not blocked mid-flight:

| Human input | Needed by (phase) | Why / notes |
|---|---|---|
| **Supabase RS256/JWKS asymmetric signing + `SUPABASE_JWT_*`** | **P2a** (C1 skeleton verifies JWTs) | C1 verifies with a verify-only public key from the JWKS endpoint — **no shared HS256 secret**. Asymmetric signing must be **confirmed/enabled** on the Supabase project (DECISIONS §2 W3). Client sign-in (P1a) needs the project earlier but not the verify key. |
| **Paid-provider-call approval** | **P2a** (first real cloud LLM call), reconfirm **P5** (broad BYOK) | Explicit authorization to spend real money on cloud inference. Skeleton runs one sanctioned test key + local-dev `STRATEGOS_KEK`. |
| **KMS/KEK (production key-encryption key in cloud KMS/HSM)** | **P4** (F3 vault handling real credentials) | Prod KEK lives in KMS/HSM; `STRATEGOS_KEK` env var is **local-dev only**. F3 is the build gate before C1 handles any real BYOK/OAuth credential (DECISIONS §2 W4). |
| **Anthropic OAuth client** (client_id/secret, redirect URI, scopes, token endpoint) | **P4** (F3 OAuth connect + refresher; pairs with **GH-2**) | v1 OAuth provider scope = **Anthropic only**; all other providers use BYOK keys. The cloud adapter's bearer/OAuth support (GH-2) must be released before the first real OAuth call. |
| **Product decisions**: content model, pricing tiers, funnel/lead routing | **P14** (W5) | W5 carries zero tenant data; these three product calls gate the marketing phase (W5 §8/§10). |

---

## 5. How the three prior graphs were reconciled (canonical decisions)

The prior ordering sources disagreed; this roadmap resolves them:

1. **F1-rework is critical path and lands before the central-plane rebuild.** The walking skeleton
   (P0–P2b) runs on the built-but-insecure F1 to prove the vertical slice, but **no hardened central
   module (C1-harden, C2, C3, C4, C5, C6, O1) builds until P3 (F1-rework) is green.** The rework
   reshapes the JWT hook, every RLS role predicate, the ledger, and the credential vault — building
   C-plane logic on the old fixed-six-role enum + insecure grants would be thrown away. This is the
   single most important sequencing constraint.

2. **The device-plane graph in `modules/README.md` is inverted** (DECISIONS §7 flags it). The correct
   order is **D1 → D2 → D4 → D3** (shell hosts the engine; the split-plane router D3 needs D1+D2+C1+C2+D4).
   The skeleton builds D1/D2/D3/D4 minimally (P1a/P1b/P2b); P10 matures them + adds O3.

3. **C2 ⇄ C3 mutual dependency resolved by co-development in one phase (P5).** The README graph says
   `C2 → C3`; the per-module headers say C2 depends on C3 (budget headroom) *and* C3 depends on C2
   (step-down/free-floor). They are genuinely mutual, so they are built together in P5: C2 lands chain
   resolution + the budget-filter interface; C3 lands the reserve→commit the filter calls.

4. **Deliberate deviation from the literal "C2/C4/C5 → C3" reading.** The task constraint lists C3
   after C2/C4/C5, but DECISIONS §2 W2 makes the **hard budget reserve a build gate before real
   spend**, and C4/C5 both make paid cloud calls. Ordering budgets (C3, in P5) *before* governance
   (C4, P6) and RAG (C5, P7) is required so no cloud spend is unmetered — this honors the *intent*
   (C3 is authoritative over what C2/C4/C5 spend) while keeping the security premise. C4/C5 still
   depend on C1 (satisfied) and emit into C3's ledger. C6-after-C1/C4, X1-after-C1/C4, W4→W1/W2/W3/W5,
   and O1/O2-after-their-sources are all honored.

5. **C5 ⇄ C6 mutual dependency resolved by contract-first.** C5 depends on C6's `quality_signals`
   *contract*; C6 depends on C5's *retrieval metrics*. C6's signals contract lands in P6; C5 emits
   into it in P7; the retrieval-precision/recall/grounding signals are wired when C5 lands. No
   circular build.

6. **Crate reality (v0.4.6) is a Strategos-side reconcile, not a doc rewrite.** MIG-1..4 fix the
   `[patch]`, adapter registration, Cargo deps, and phase-plan wording to the real `sensei-*` crates
   (there is **no** `gateway-embedded` / `InferenceAdapter`). These are done inside the reconcile
   phases (P0, P1b, P2a, P2b) with a live compile loop — not blind-edited.

7. **GH-1 and GH-2 are explicit graph nodes.** GH-1 (trace plane) is released before P2b/P5/P10/P12
   (every unified-trace / plane-split consumer). GH-2 (OAuth adapter) is released before P4 (F3 OAuth).
   GH-4/5/6/7 are decide/investigate items sequenced before P5/P6/P11 respectively; GH-3 is resolved
   (embedded path exists) and GH-8 (rerank trait) is deferred — v1 rerank is a C5 service.
