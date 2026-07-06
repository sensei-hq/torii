# Strategos — Client + Admin Build-Out (blueprint)

> **Status:** Design agreed 2026-07-06 · **Scope:** the two front-of-house apps (desktop **Member Console** client + web **Admin Portal**), the shared design system, and the central gateway service that makes them functional. · **Supersedes for scope:** the older "MCP/agents deferred, fixed roles" note — the mockups (`docs/mockups/`) are authoritative. · **Feeds:** per-phase implementation plans in `docs/plans/`.

This blueprint turns `docs/mockups/` into a build plan. It builds **on the existing `monorepo/`** (F1 schema + Supabase already done) and stands on two sibling libraries as stepping stones — both consumed dev-in-place and enhanced upstream: the **`gateway/` engine crates** (v0.2.23, inference) and **Kavach** (`~/Developer/kavach`, v1.0.0-next.37, SvelteKit auth).

---

## 1. Goal & scope

Ship, in priority order:

1. **The client** — a **Tauri 2 + SvelteKit** desktop app that _is_ the Member Console (Workspace, Ask, Library, Playground, Workflows, Activity, Settings), with an on-device execution plane (local models, offline, $0) and cloud calls proxied to the central gateway.
2. **The central gateway service (C1)** — a **Rust + Axum** service wrapping the `gateway` crate: the sole authority for cloud (BYOK) inference. Required for the client's cloud story.
3. **The admin web SaaS** — a **SvelteKit → Cloudflare Pages** app (`admin.`) that owns every control the client and gateway enforce.

A web-hosted Member Console (`app.`) is **out of scope** for this plan (the client is the desktop app); the SvelteKit console can be shipped web later with local features gated off.

### Locked decisions (2026-07-06)

- **Mockups are authoritative** for v1 features: **MCP & tools in**, **programmatic API keys in**, **agents/plans = design the screens, build v2**, **generic hierarchical roles/org tree with cascading budgets**.
- **Topology:** Admin = separate web SaaS app; Client = desktop Tauri app; the two share `packages/ui` + `packages/core`.
- **Priority:** client first, admin second (required — it owns the controls).
- **Package manager:** **bun** (workspaces).
- **Desktop local store:** **no heavy DB.** The only thing that runs locally is the embedded gateway (local inference) + its on-disk model registry, plus the OS keychain for the device token. Offline resilience (Phase 2) caches the config snapshot + usage buffer in a **lightweight local store** (SQLite via `tauri-plugin-sql`, or the Tauri store) — a handful of rows, not a full DB. On-device RAG / vector storage is **deferred** (retrieval is central via C5); revisit `sqlite-vec` vs embedded `pgvector` only if we later add on-device retrieval. _(This resolves D1's "SQLite vs embedded Postgres" open question: neither — a minimal store, added only when offline lands.)_
- **Local streaming:** `gateway-embedded` has no streaming yet → local Ask is **non-streaming** first; cloud Ask (via C1) streams over SSE.
- **Auth:** **Kavach** + its **Supabase adapter** is the auth/session substrate for both apps (sign-in, sessions, declarative role-based route protection, auth UI); its adapter also does Data / Storage / Logging, which `packages/core` builds on. The desktop needs a new **client-only session mode** (kavach is server/cookie-based today) — the first upstream enhancement, on the client's critical path. See §6b.

---

## 2. Architecture — split-plane

Two planes, faithful to `docs/README.md`:

- **Config / governance plane (central, the authority):** Supabase (Auth/JWT, Postgres+RLS per tenant, Storage, Realtime) + **C1** (Axum, the only place provider keys decrypt).
- **Execution plane (central _or_ on-device):** cloud steps → C1; local steps → the desktop's embedded engine.

```
              ┌──────────── CLOUD: config / governance ────────────┐
   Admin ───▶ │ admin.  (SvelteKit → Cloudflare Pages)              │
              │ Supabase: Auth · Postgres(RLS) · Storage · Realtime │
   Client ──▶ │ api.    (C1 — Rust/Axum wraps `gateway` crate)      │
              │   BYOK calls · budgets · audit · guardrails         │
              └──────▲───────────────────────────────┬─────────────┘
        usage/audit ─┘   pull config + Realtime push  │
              ┌──────── DEVICE: execution (Tauri) ─────▼────────────┐
   Client ──▶ │ Member Console UI ──IPC──▶ src-tauri (Rust)         │
              │   embedded `gateway`+`gateway-embedded` (local, $0) │
              │   split-plane router: cloud steps → C1              │
              │   on-disk model files · OS keychain                 │
              │   (lightweight offline config/usage cache)          │
              └─────────────────────────────────────────────────────┘
```

### Data flow (who talks to what)

- **Desktop client** → Supabase directly (auth, config pull, RLS'd library/activity) · → its Rust backend over IPC for **local** inference · → **C1** for **cloud** inference. **Provider keys never touch the device.**
- **Split-plane router (D3, in `src-tauri`)** walks a fallback chain step-by-step: local-capable step → embedded engine; key-needing step → proxy to C1 (device token + Supabase JWT). Merges one unified trace with a per-step execution-location badge.
- **C1** validates JWT → tenant scope, assembles `GatewayConfig` from Postgres, injects decrypted keys via `refresh_router_keys()`, streams via SSE, persists every call through `GatewayStore`.
- **Admin web** → Supabase directly (RLS CRUD) to write routers/models/chains/budgets/policies; reads the ledger C1 writes.

---

## 3. Monorepo layout (new)

```
monorepo/
  apps/
    desktop/                 # ① CLIENT — Tauri 2 + SvelteKit (Svelte 5)
      src/                   #   SvelteKit frontend = the Member Console UI
      src-tauri/             #   Rust: IPC commands, embeds gateway-embedded,
                             #   split-plane router (D3), config sync (D4),
                             #   OS keychain, lightweight offline cache (SQLite/store)
    admin/                   # ② ADMIN — SvelteKit web → Cloudflare Pages
  packages/
    ui/                      # W4 design system (Rokkit): Zen-Sumi→Rokkit tokens/skins,
                             #   shared atoms, ⌘K command palette
    core/                    # shared TS: auth (Kavach) + typed data-access on the Kavach
                             #   Supabase adapter, zod schemas mirroring gateway + DB,
                             #   the swappable data-access layer
  services/
    gateway/                 # ③ C1 — Rust Axum service wrapping `gateway`
  Cargo.toml                 # Rust workspace: services/gateway + apps/desktop/src-tauri
                             #   [patch] → ../gateway/crates/*  (dev in-place)
  package.json               # bun workspace: apps/*, packages/*
  database/ supabase/ docs/  # unchanged (F1 built)
```

- Two SvelteKit apps, **separate**, sharing `packages/ui` + `packages/core`.
- One Cargo workspace covering **C1** and the **Tauri backend**, both `[patch]`-ing the sibling `gateway/` repo. Production consumes the engine via a pinned git tag; dev uses the path patch.
- **Kavach** (`@kavach/*`) is linked dev-in-place from the sibling `~/Developer/kavach` bun workspace (exact mechanism — bun link vs path dep vs vendored member — chosen at Phase 0); production consumes published `@kavach/*`. Same consume-and-enhance model as the gateway.

---

## 4. Design system (`packages/ui`, W4)

Port the mockups' **Zen-Sumi** language (washi paper / sumi ink / one vermillion accent) onto **Rokkit** so every app is consistent and themeable:

- Zen-Sumi CSS tokens → a **Rokkit skin** + named semantic tokens (`paper`/`ink`/`primary`/`on-primary`/`*-soft`) via `rokkit.config.js` (palette → skin → tokens); light/dark dual palettes. _(Consult `semantic-styles-rokkit`, `skin-system-rokkit`.)_
- Migrate the ~30 shared atoms catalogued from the mockups: `Pill`, `Tag`, `Meter/Bar`, `Switch`, `CtrlRow`, `PageHeader`, `ProviderDot`, **`ExecBadge`**, `EnvChip`, `DeviceFooter`, `DevicePill`, `OfflineBanner`, `DesktopOnlyNote`, `ModelPicker`, `RoutingPanel`, `SaveSnippetButton`, `WorkspaceChip`. Use Rokkit primitives (List/Tree/Select/MultiSelect/Table/Tabs/Toggle/Menu) data-first. _(Consult `rokkit-components`.)_
- **⌘K command palette** + workspace switcher via `@rokkit/states` + `@rokkit/actions`. _(Consult `command-system-rokkit`.)_

`packages/ui` is consumed by both apps (bundled into the Tauri build, imported by the Cloudflare Pages build).

---

## 5. Data layer (`packages/core`)

A **swappable data-access interface** so UI iteration is fast and integration is honest:

- **Mock adapter** — seeded from the mockups' `data.jsx` (MODELS, ROUTERS, FALLBACK_CHAIN, BUDGET_TREE, WORKSPACES, WS_DOCS, WORKFLOWS…). Lets a screen be built before its backend exists.
- **Supabase adapter** — real RLS'd reads/writes via the **Kavach Supabase adapter** (`getActions()`: get/post/put/patch/delete/call + `connection`), audit logging via `getLogWriter()` → `audit_events`; typed + zod-validated here. Per screen we swap mock→real behind the same interface.
- **Gateway client** — typed C1 client (chat/embed/generate/compare + SSE); on desktop, the split-plane router decides local-vs-C1 and this client is the cloud leg.
- **zod schemas** mirror the gateway request/response shapes (§6) and DB rows, shared by both apps.

---

## 6. Gateway integration contracts (from the engine API scan)

**C1 (Axum, wraps `gateway` v0.2.23):**

- Startup: `Gateway::new(config, AdapterRegistry, CircuitBreakerManager)`; register the 15 cloud adapters.
- Implement **`GatewayStore`** against Postgres (`insert_inference_call`, `insert_execution_trace`, `get_spend_since`, …) → feeds C3/O1/O2.
- Config assembly: build `GatewayConfig { routers, models, chains }` from DB; inject keys at call time via `refresh_router_keys(|router_id| …decrypt from vault…)` (F3). Keys never leave C1.
- Endpoints: `POST /v1/{chat,embed,generate,compare}` → `gateway.execute(&InferenceRequest)`; **SSE** endpoint streams `StreamChunk`. `PATCH /config` → `gateway.update_config()`.
- Auth middleware: validate Supabase JWT → `tenant_id`/`role`; scope every query.
- Types are shared vocabulary: `Capability` (TextChat/TextEmbed/…), `Payload` (Chat/Embed/…), `InferenceRequest{capability,model?,router?,chain?,payload,budget?}`, `InferenceResponse{content?,usage?,attempts[],…}`.

**Desktop (`src-tauri`, embeds `gateway-embedded` v0.2.23):**

- Model registry via `ChainedResolver::new().push(Managed).push(Ollama).push(External)`; `ModelEntry`/`ModelSource`.
- Local adapters feature-gated: **`fastembed`** (embeddings) + **`llama-cpp`** (GGUF chat) in v1; `ort` optional later. Same `InferenceAdapter` trait as cloud, so chains mix planes.
- Split-plane router: local step → local `Gateway::execute()`; cloud step → HTTP to C1. Merge into one trace. (Local `stream()` unsupported → non-streaming.)

---

## 6b. Auth substrate — Kavach (consume + enhance)

Auth for both apps uses **Kavach** (`~/Developer/kavach`, v1.0.0-next.37) + `@kavach/adapter-supabase` — consumed dev-in-place and **enhanced upstream**, the same model as the gateway crate. Kavach provides: credential / magic-link / OAuth(SSO) sign-in, session management, **declarative role-based route protection** (`@kavach/sentry` + `kavach.config.js` rules — private-by-default, 401/403 + redirects), pre-built auth UI (`@kavach/ui`: `AuthPage` / `LoginCard` / `AuthProvider` / `AuthPassword`) for the Sign-in screen, and a Supabase adapter that also does **Data (PostgREST) / Storage / Logging**.

- **Admin web (SSR on Cloudflare):** native fit — `kavach.handle` server hook + `kavach.config.js` route rules work out of the box.
- **Desktop client (Tauri SPA, no server):** kavach's core session is **cookie/server-endpoint dependent → does not work as-is.** The **client-only session mode** is the first upstream enhancement and sits on the client's critical path (Phase 1): sign-in via the adapter's client auth methods (`signInWithPassword` / `signInWithOtp` / `signInWithOAuth` + `onAuthStateChange`), session persisted in a client store (Tauri store / localStorage) with local refresh, and `@kavach/sentry` role rules evaluated client-side.
- **`packages/core`** builds typed, zod-validated data access on the adapter's `getActions()` and audit logging on `getLogWriter()`, keeping the mock adapter swappable behind one interface.
- **Claims:** `tenant_id` / `role` / `groups` already land in the JWT via the existing `custom_access_token_hook` and are read from `app_metadata`; kavach consumes them for the session + route rules.

**Enhancements Strategos contributes back to Kavach ("two birds"):**

1. **Client-only session mode** — SPA / Tauri / offline session without a SvelteKit server _(Phase 1, client-critical)_.
2. **Multi-tenant + role hierarchy** — tenant/org context in the session and a hierarchical / multi-role model (kavach is flat-`role` today) to match the generic org→dept→team→user tree, with route rules that understand it _(claims consumed from Phase 1; hierarchy-aware rules land with Phase 4 admin RBAC)_.
3. **Device enrollment + device-scoped tokens** — register a device, issue/rotate a device-scoped token _(F2; feeds D4 sync + O3 fleet; Phase 2)_.

These are tracked as upstream kavach work alongside the Strategos screens they unblock (F2).

---

## 7. Screens → modules (build map)

From the mockup catalog. **Client (desktop):** Workspace, Ask, Library (document workspace), Playground, Workflows, Activity/Requests, Settings, Local Models `[D]`, Sign-in. **Admin (web):** Overview, Requests & audit, Organization (roles + budget tree + IdP), Onboarding, Models, Routing, Connections, Governance, Budgets & billing, Settings, + new: Tools & MCP, Device fleet, Feature management, Spaces & KB, API keys, Alerts. Each maps to modules W1/W2/W3/W4 + D1–D4 + C1 and the gap analysis (`docs/design/mockup-feature-gaps.md`).

Mockup editors that are **read-only today and must become editable** (gap §4): Connections (connect/rotate/revoke), Routing (chain editor), Models (add/enable/pricing), Governance (classification/masking/retention).

---

## 8. Build phases (client-first)

Each phase is independently demoable and ends lint+test clean (zero-errors policy).

### Phase 0 — Scaffold + design system

- bun workspace (`apps/*`, `packages/*`) + Cargo workspace (`services/gateway`, `apps/desktop/src-tauri`) with `[patch]` → `../gateway/crates/*`.
- `packages/ui`: Zen-Sumi→Rokkit skin/tokens + core atoms + ⌘K palette.
- `packages/core`: swappable data layer (mock adapter from `data.jsx`) + zod schemas, built on the **Kavach Supabase adapter**.
- **Kavach**: link `@kavach/*` dev-in-place; set up `kavach.config.js` route rules + `@kavach/ui` auth components; stub the client-only session interface the desktop implements in Phase 1.
- **Done when:** both empty apps boot with the shared shell chrome + skin; Storybook-style atom preview renders.

### Phase 1 — Client walking skeleton (local plane)

- Desktop shell: title bar, nav rail, `EnvChip`, `DeviceFooter`, workspace ⌘K palette; **auth via Kavach's client-only session mode** (the first upstream kavach enhancement — sign-in + client-side session store + client-side `@kavach/sentry` route guard in the Tauri SPA); Sign-in screen from `@kavach/ui`.
- `src-tauri`: embed `gateway-embedded` (fastembed + llama-cpp), `ChainedResolver`, expose local inference + registry over IPC; OS keychain for the device token; local-only split-plane router. **No relational store needed here** — the model registry scans disk.
- **Ask** end-to-end on a **local** model — offline, $0, `ExecBadge` "on your device"; minimal **Local Models** screen (list/resolve/set default).
- Playwright E2E (`tauri-playwright-testing`, `tauri-screen-dev`).
- **Done when:** a user signs in, asks a question, and gets a grounded answer from a local model with the right execution badge — with the network off.

### Phase 2 — Central gateway (C1) + cloud plane

- `services/gateway`: Axum + `gateway` crate; JWT auth; config assembly from Postgres; `GatewayStore`→Postgres; `refresh_router_keys` from the vault; `/v1/*` + SSE.
- Desktop: split-plane router proxies cloud steps to C1 (device token + JWT); **config sync (D4)** — Realtime subscribe + versioned pull + `update_config` hot-reload; offline config snapshot + usage buffer in the lightweight local store (first place local persistence is introduced).
- **Done when:** Ask serves cloud + local, a chain spans both planes, ExecBadge is accurate per step, and spend/audit land centrally.

### Phase 3 — Client breadth

- **Library** → document workspace: collections/tags, ingestion status, extracted-assets browser, preview pane, bulk actions, space settings. _(Ingestion backend = C5; surfaced minimally/stubbed until C5 lands.)_
- **Playground** (W3): retrieval-mode selector + hybrid slider + rerank picker + chunking selector, retrieval inspector, live meters, compare, promote-to-default.
- **Workflows**: index + builder + runs + governance views; agent preview badged "agent · v2" (design-only).
- **Activity**: ledger with execution-location + filters + budget cascade + budget-request flow.
- **Settings (personal)**: preferences within the admin floor, locked-by-admin indicators, local-model management.

### Phase 3.5 — F1 schema gap-check (before admin)

- dbd schema extension for the mockup decisions the built DDL lacks: **MCP servers + tool allow-lists**, **tenant API keys / service accounts** (budget_nodes already has a `service` kind to hang these on), and confirm/extend the **roles & permissions matrix** (the generic hierarchy `group_levels`/`access_groups` and cascading `budget_nodes` already exist). Agents stay deferred.
- **Done when:** `dbd reset && apply && import` is green and the new tables have RLS + import procedures.

### Phase 4 — Admin web SaaS (the controls)

- `apps/admin`: shell/nav + auth; then all admin screens, with the read-only mockup editors made **editable** and the new surfaces (Tools & MCP, Device fleet, Feature management, Spaces & KB, API keys, Alerts). Most are Supabase RLS CRUD writing the config C1 + desktop consume.
- **Done when:** an admin can connect a router, define a chain, set budgets/policies, and the desktop client picks the change up live (Realtime) and enforces it.

### Phase 5 — (deferred) Web Member Console

- Optional: ship the SvelteKit console as a web build (`app.`) with local features gated off. Not planned here.

---

## 9. Cross-cutting concerns

- **Auth:** via **Kavach** + Supabase adapter (see §6b). JWT custom claims (`tenant_id`, `role`, `groups`) come from the existing `custom_access_token_hook`, read from `app_metadata`; device enrollment issues a device-scoped token (F2). Admin uses kavach SSR route protection; desktop uses the client-only session mode.
- **Execution-location awareness:** `ExecBadge` everywhere a call runs (Ask, Playground, Activity, Models, Routing); driven by the split-plane router's per-step plane flag.
- **Desktop-vs-web / offline:** `StrategosEnv`-style capability flag (desktop/offline/web) gates local-only features; `OfflineBanner`, `DesktopOnlyNote`, offline buffer surfaced in `DeviceFooter`.
- **Feature governance (3-level model):** workspace default (admin) → space override (space owner) → user preference (member, where allowed); backed by `modules`/`features`/`feature_states`; member toggles render locked where policy dictates.
- **Security:** keys custody is central-only; RLS on every tenant table; JWT-scoped C1; encrypted BYOK vault (F3). Web apps get standard security headers; validate all inputs at the C1 boundary.

---

## 10. Testing

- **UI:** component tests for `packages/ui` atoms; per-screen tests against the mock data adapter.
- **Desktop E2E:** Playwright against the Tauri app (globalSetup, build flags, TauriPage caveats) per the `tauri-playwright-testing` skill.
- **C1:** Rust integration tests over `execute()` + `GatewayStore` (Postgres) + SSE; reuse the engine's adapter test patterns.
- **DB:** the existing `tests/rls.sql` harness extended for the new tables.
- Every phase satisfies the **zero-errors policy** (lint + tests clean at start and finish).

---

## 11. Deferred / open decisions

- On-device retrieval (local RAG): if/when we add it, choose the vector store (`sqlite-vec` vs embedded `pgvector`). Not in v1 — retrieval is central (C5).
- Exact lightweight offline store (Phase 2): `tauri-plugin-sql` (SQLite) vs the Tauri store plugin — pick at D4 implementation.
- Kavach client-only session: build as a Strategos-side adapter first then upstream to kavach core, or land directly in kavach — decide at Phase 1.
- Kavach link mechanism (bun link vs path dep vs vendored workspace member) — Phase 0.
- Whether to add streaming to `gateway-embedded` upstream (engine repo) or keep local non-streaming.
- Which advanced RAG modes (RAPTOR/GraphRAG/ColBERT/SQL-RAG) are exposed in Playground v1 — tie to C5.
- Web Member Console (`app.`) — if/when.
- SSO/SCIM depth in v1 vs fast-follow (F2).

---

## 12. Relationship to module docs

This blueprint sequences and connects existing seeds: **W4** (Phase 0), **D1/D2** + **W2** Ask + **F2** auth via Kavach (Phase 1), **C1/D3/D4** (Phase 2), **W2 breadth + W3** (Phase 3), **F2/F3 + O1/O2/O3 + X1** surfaced through **W1** (Phase 4). It does not replace those docs; each phase expands the relevant module seed into a `docs/plans/` implementation plan.
