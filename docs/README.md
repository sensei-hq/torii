# Torii — what we're building

This is the builder-facing overview. For the product pitch see the [root README](../README.md); for the per-module breakdown see [`modules/`](modules/); for design notes and the mockup gap analysis see [`design/`](design/).

> **Authoritative:** the ratified v1 scope/architecture/security decisions live in [`DECISIONS.md`](DECISIONS.md) (2026-07-23). Where anything below disagrees, that document wins.

## In one paragraph

Torii is a multi-tenant **AI gateway for organizations**. An organization connects its provider keys once (BYOK) into an encrypted vault; every member then gets **governed, key-less access** to every model through fallback chains, with budgets, guardrails, and a full audit trail enforced on each call. It ships as a **web Admin Portal**, a **web + desktop Member Console**, and a **marketing site**, backed by a **central gateway service** and **Supabase**.

## Architecture — split-plane

We separate the **config/governance plane** (central, the authority) from the **execution plane** (central _or_ on-device).

```
        ┌──────────────────────── CLOUD: config / governance plane ────────────────────────┐
 Admin ▶│  seiki.sensei-hq.com (Admin Portal, SvelteKit+Rokkit → Cloudflare Pages)│
        │  app.torii.sensei-hq.com   (Member Console, web)                              │
 Member▶│  torii.sensei-hq.com       (Marketing site)                                   │
        │                                                                                   │
        │  Supabase: Auth/SSO · Postgres (RLS, per-tenant, dbd-managed) · Storage · Realtime │
        │  api-torii.sensei-hq.com   (Central gateway — Rust/Axum, wraps `gateway` crate)│
        │     • cloud BYOK calls (keys never leave) · budgets · audit · guardrails · RAG     │
        └──────────────▲──────────────────────────────────────────────┬────────────────────┘
          usage/audit ─┘   pull config + wrapped keys                  │ Realtime: config changed
        ┌────────────────────────── DEVICE: execution plane (Tauri app) ▼─────────────────────┐
        │  Member Console UI (reused) ──IPC──▶ in-process `sensei-local-engine`/`-providers`   │
        │     • local models / embeddings / reasoning (EmbeddedLlamaAdapter, no daemon; $0)     │
        │     • split-plane router: cloud steps → central gateway; local steps → on-device     │
        │  OS keychain (device session) · SQLite + sqlite-vec (config cache · local RAG)       │
        └──────────────────────────────────────────────────────────────────────────────────-─┘
```

- **Central gateway is the authority** for all cloud (BYOK) calls — keys never leave it; budgets, audit, residency, and guardrails are enforced centrally.
- **Desktop adds a local execution plane** via the in-process `sensei-local-engine`/`sensei-local-providers` crates (local models, embeddings, offline — no daemon) and proxies cloud steps to the central gateway. Fallback chains can span both planes.
- **Two clients, one brain:** Admin Portal (web), Member Console (web cloud-only + desktop cloud+local). The web member app and admin portal share the `app.`/`admin.` origins for simple auth.

## Tech stack

| Layer            | Choice                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inference engine | Six **`sensei-*`** crates (`sensei-kernel`, `sensei-gateway`, `sensei-cloud-providers`, `sensei-local-engine`, `sensei-local-providers`, `sensei-kokoro`) — external repo [`sensei-hq/gateway`](https://github.com/sensei-hq/gateway), pinned **`tag = "v0.4.6"`**, `[patch]` for in-place dev. Capability-segregated traits (`ChatModel`/`EmbedModel`/…) — no `gateway-embedded`, no `InferenceAdapter` |
| Central service  | **Rust + Axum** wrapping `sensei-gateway`; implements `GatewayStore` against Postgres; SSE streaming; validates Supabase JWTs via **RS256/JWKS**                                |
| Desktop app      | **Tauri 2 + SvelteKit (Svelte 5)**; embeds `sensei-local-engine` + `sensei-local-providers` (`EmbeddedLlamaAdapter` in-process llama.cpp / `OrtAdapter`, no daemon; registry handles model pull); SQLite + sqlite-vec (config cache + local RAG); OS keychain (patterns reused from Sensei) |
| Web apps         | **SvelteKit (Svelte 5) + Rokkit** (components, semantic-styles, skins, command palette) → **Cloudflare Pages**                                                                  |
| Backend          | **Supabase** — Auth (email/OAuth → SSO/SAML), Postgres + RLS (per-tenant), Storage, Realtime (config push), Edge Functions (enroll, key re-wrap, usage ingest)                  |
| Database mgmt    | **dbd** — DDL apply, seed import, migrations/deploy (drives `database/`)                                                                                                        |
| Hosting          | Cloudflare Pages (web/site) · container host (Cloud Run / Fly.io / Fargate) for the gateway · Cloudflare DNS/WAF in front                                                       |

## Domains

`torii.sensei-hq.com` (marketing) · `app.` (Member Console) · `admin.` (Admin Portal) · `api.` (central gateway).

## Module map

Modules are grouped **F**oundations · **C**entral gateway · **D**evice runtime · **W**eb/clients · **O**bservability. Each has a doc in [`modules/`](modules/) that later expands into a full spec.

- **Foundations:** F1 Data model & schema · F2 Identity, Auth & RBAC · F3 Key vault & crypto
- **Central gateway:** C1 Gateway service & API · C2 Routing, chains & resilience · C3 Budgets & metering · C4 Governance runtime · C5 RAG & document intelligence
- **Device runtime:** D1 Desktop shell & local store · D2 Embedded local gateway & model manager · D3 Split-plane router · D4 Config sync & offline
- **Web / clients:** W1 Admin Portal · W2 Member Console · W3 Playground & retrieval lab · W4 Design system (Rokkit) · W5 Marketing site
- **Observability & ops:** O1 Request ledger, audit & SIEM · O2 Analytics & cost insights · O3 Device fleet & feature governance
- **In v1 (decisions resolved — see [`DECISIONS.md`](DECISIONS.md)):** X1 Tools & MCP (full) · X2 Agents & plans (**design-only** screens in v1; runtime v2)

## RAG / document direction (summary)

Markdown-first ingestion (prose / tables→CSV / images→captions separated) → structure/semantic chunking → **contextual retrieval + hybrid (dense+BM25) → cross-encoder rerank** → grounded answers with citations. RAPTOR / GraphRAG / ColBERT late-interaction / SQL-RAG offered as advanced per-space modes. The Library becomes a real document workspace (collections, versions, lineage, extracted-asset browser). Full detail in [`design/mockup-feature-gaps.md`](design/mockup-feature-gaps.md) §3.

## How we build

Module by module. For each: **design doc → spec → plan → implement**, following the project's zero-errors policy (lint + tests clean at start and finish). DB changes go through **dbd**. UI is built with **Rokkit** (consult the rokkit skills at implementation time). The gateway is consumed as the external versioned crate; engine changes happen in `sensei-hq/gateway` and are pulled in via tag bump.

## Decisions (resolved 2026-07-23 — see [`DECISIONS.md`](DECISIONS.md))

1. **Tools / MCP** — **in v1, full.** Server registry + per-(role×space) tool allow-lists, gateway-enforced at tool-call time. (X1)
2. **Programmatic API access** — **yes, in v1.** Scoped tenant API keys + service accounts, owned by the **Organization** screen, capability scope + rate-limit + reveal-once. **NO per-key budget** — a key authenticates an identity; spend rolls up to that identity's budget node (DECISIONS §2 W2). (affects C1)
3. **Agents / plans** (ReAct + DAG) — **design-only in v1** (build the Workflows screens; runtime deferred to v2). (X2)
4. **Roles** — **full role + permission matrix** (`roles`/`role_permissions`/`profile_roles`), one hierarchical tree driving permissions **and** budgets. Replaces the fixed enum. (affects F2)

Security posture (also in `DECISIONS.md`): gateway-mediated privileged writes · hard budget reserve on hard-cap nodes · RS256/JWKS · F3 key-vault before any real provider key + KMS-backed KEK.
