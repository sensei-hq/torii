# Strategos — what we're building

This is the builder-facing overview. For the product pitch see the [root README](../README.md); for the per-module breakdown see [`modules/`](modules/); for design notes and the mockup gap analysis see [`design/`](design/).

## In one paragraph

Strategos is a multi-tenant **AI gateway for organizations**. An organization connects its provider keys once (BYOK) into an encrypted vault; every member then gets **governed, key-less access** to every model through fallback chains, with budgets, guardrails, and a full audit trail enforced on each call. It ships as a **web Admin Portal**, a **web + desktop Member Console**, and a **marketing site**, backed by a **central gateway service** and **Supabase**.

## Architecture — split-plane

We separate the **config/governance plane** (central, the authority) from the **execution plane** (central _or_ on-device).

```
        ┌──────────────────────── CLOUD: config / governance plane ────────────────────────┐
 Admin ▶│  admin.strategos.sensei-hq.com (Admin Portal, SvelteKit+Rokkit → Cloudflare Pages)│
        │  app.strategos.sensei-hq.com   (Member Console, web)                              │
 Member▶│  strategos.sensei-hq.com       (Marketing site)                                   │
        │                                                                                   │
        │  Supabase: Auth/SSO · Postgres (RLS, per-tenant, dbd-managed) · Storage · Realtime │
        │  api.strategos.sensei-hq.com   (Central gateway — Rust/Axum, wraps `gateway` crate)│
        │     • cloud BYOK calls (keys never leave) · budgets · audit · guardrails · RAG     │
        └──────────────▲──────────────────────────────────────────────┬────────────────────┘
          usage/audit ─┘   pull config + wrapped keys                  │ Realtime: config changed
        ┌────────────────────────── DEVICE: execution plane (Tauri app) ▼─────────────────────┐
        │  Member Console UI (reused) ──IPC──▶ embedded `gateway`+`gateway-embedded`           │
        │     • local models / embeddings / reasoning (offline, $0)                            │
        │     • split-plane router: cloud steps → central gateway; local steps → on-device     │
        │  OS keychain (device session) · embedded Postgres/SQLite (config cache · local RAG)  │
        └──────────────────────────────────────────────────────────────────────────────────-─┘
```

- **Central gateway is the authority** for all cloud (BYOK) calls — keys never leave it; budgets, audit, residency, and guardrails are enforced centrally.
- **Desktop adds a local execution plane** via `gateway-embedded` (local models, embeddings, offline) and proxies cloud steps to the central gateway. Fallback chains can span both planes.
- **Two clients, one brain:** Admin Portal (web), Member Console (web cloud-only + desktop cloud+local). The web member app and admin portal share the `app.`/`admin.` origins for simple auth.

## Tech stack

| Layer            | Choice                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inference engine | **`gateway`** + **`gateway-embedded`** crates — external repo [`sensei-hq/gateway`](https://github.com/sensei-hq/gateway), pinned `tag = "v0.2.18"`, `[patch]` for in-place dev |
| Central service  | **Rust + Axum** wrapping the `gateway` crate; implements `GatewayStore` against Postgres; SSE streaming; validates Supabase JWTs                                                |
| Desktop app      | **Tauri 2 + SvelteKit (Svelte 5)**; embeds `gateway`+`gateway-embedded`; embedded Postgres/SQLite; OS keychain (patterns reused from Sensei)                                    |
| Web apps         | **SvelteKit (Svelte 5) + Rokkit** (components, semantic-styles, skins, command palette) → **Cloudflare Pages**                                                                  |
| Backend          | **Supabase** — Auth (email/OAuth → SSO/SAML), Postgres + RLS (per-tenant), Storage, Realtime (config push), Edge Functions (enroll, key re-wrap, usage ingest)                  |
| Database mgmt    | **dbd** — DDL apply, seed import, migrations/deploy (drives `database/`)                                                                                                        |
| Hosting          | Cloudflare Pages (web/site) · container host (Cloud Run / Fly.io / Fargate) for the gateway · Cloudflare DNS/WAF in front                                                       |

## Domains

`strategos.sensei-hq.com` (marketing) · `app.` (Member Console) · `admin.` (Admin Portal) · `api.` (central gateway).

## Module map

Modules are grouped **F**oundations · **C**entral gateway · **D**evice runtime · **W**eb/clients · **O**bservability. Each has a doc in [`modules/`](modules/) that later expands into a full spec.

- **Foundations:** F1 Data model & schema · F2 Identity, Auth & RBAC · F3 Key vault & crypto
- **Central gateway:** C1 Gateway service & API · C2 Routing, chains & resilience · C3 Budgets & metering · C4 Governance runtime · C5 RAG & document intelligence
- **Device runtime:** D1 Desktop shell & local store · D2 Embedded local gateway & model manager · D3 Split-plane router · D4 Config sync & offline
- **Web / clients:** W1 Admin Portal · W2 Member Console · W3 Playground & retrieval lab · W4 Design system (Rokkit) · W5 Marketing site
- **Observability & ops:** O1 Request ledger, audit & SIEM · O2 Analytics & cost insights · O3 Device fleet & feature governance
- **Pending decision:** X1 Tools & MCP · X2 Agents & plans

## RAG / document direction (summary)

Markdown-first ingestion (prose / tables→CSV / images→captions separated) → structure/semantic chunking → **contextual retrieval + hybrid (dense+BM25) → cross-encoder rerank** → grounded answers with citations. RAPTOR / GraphRAG / ColBERT late-interaction / SQL-RAG offered as advanced per-space modes. The Library becomes a real document workspace (collections, versions, lineage, extracted-asset browser). Full detail in [`design/mockup-feature-gaps.md`](design/mockup-feature-gaps.md) §3.

## How we build

Module by module. For each: **design doc → spec → plan → implement**, following the project's zero-errors policy (lint + tests clean at start and finish). DB changes go through **dbd**. UI is built with **Rokkit** (consult the rokkit skills at implementation time). The gateway is consumed as the external versioned crate; engine changes happen in `sensei-hq/gateway` and are pulled in via tag bump.

## Open decisions (affect module scope)

1. **Tools / MCP** in v1? (X1)
2. **Programmatic API access** for the org's own apps, or only the two first-party clients? (affects C1)
3. **Agents / plans** (ReAct + DAG) in scope or later? (X2)
4. **Custom roles** vs the fixed four (Owner / Admin / Editor / Viewer)? (affects F2)
