# Strategos

> **Every model. One governed doorway.**

Strategos is an **AI gateway for organizations**. It sits between your people and every LLM provider, router, and model — applying **budgets, fallback chains, guardrails, and full observability** on every call. Connect your provider keys once; give the whole company **governed, key-less access**. Buy one license; govern it like thousands.

## The problem

Teams adopting AI hit the same walls:

- **Keys everywhere.** API keys get pasted into apps, notebooks, and `.env` files — impossible to rotate, audit, or revoke.
- **No spend control.** A single bad loop or a busy week produces a surprise bill; there's no per-team or per-person budget.
- **Lock-in & fragility.** Code is wired to one provider; an outage or a price change means an emergency migration.
- **No governance.** No record of who asked what, what was sent to whom, what was masked, or which model actually answered.

## What Strategos does

- **Managed BYOK access for all.** Provider keys live in an encrypted org vault. Members get governed access through the gateway and **never handle a key**.
- **Fallback chains.** Calls always finish at the right price — step down to a cheaper tier under budget pressure, fail over to another provider on an outage, drop to a free local model as the floor.
- **Governance.** Role-based access, four-level confidentiality, PII/tenant masking, grounded-only answers, and an immutable audit trail (SIEM-streamable).
- **Security.** Per-tenant envelope encryption (DEK/KEK), SSO/SCIM identity, data-residency pinning.
- **Budgets.** Cascading caps — org → department → team → user — with hard/soft limits, alerts, and automatic step-down.
- **Knowledge.** A shared document library with markdown-first ingestion and modern RAG (hybrid + reranking + contextual retrieval) so people can _ask their documents_.

## How it's built — the "split-plane" architecture

Strategos separates the **config/governance plane** (central, the authority) from the **execution plane** (which can run centrally _or_ on the device).

```
   CLOUD  ── config / governance plane ──┐         ┌── DEVICE ── execution plane (Tauri) ──┐
   Supabase (Auth/SSO · Postgres+RLS ·   │         │  Embedded Rust gateway (local models, │
   Storage · Realtime) + Admin console   │◀──push──│  embeddings, offline)                 │
   Central Rust gateway (cloud BYOK,     │  pull   │  proxies cloud calls ──▶ central       │
   budgets, audit, guardrails)           │────────▶│  gateway (keys never on device)        │
   └──────────────────────────────────────┘         └──────────────────────────────────────┘
```

- **Central gateway** (Rust + Axum, wrapping the `gateway` crate) is the authority for all **cloud (BYOK)** calls: keys never leave it, and budgets, audit, residency, and guardrails are enforced centrally.
- **Desktop app** (Tauri + SvelteKit) embeds the `gateway-embedded` crate to run **local models, embeddings, and reasoning** — offline-capable, $0, private — and proxies any cloud step to the central gateway.
- **Two clients, one brain:** the **Member Console** runs on web (cloud-only) and desktop (cloud + local); the **Admin Portal** is web. Fallback chains can span both planes.
- **Backend:** Supabase (Auth/SSO, Postgres with row-level security, Storage, Realtime config push). Web console + marketing site deploy to **Cloudflare Pages**; the Rust gateway runs as a container (Cloud Run / Fly.io / Fargate).

## Repository layout

```
monorepo/
├── README.md              ← you are here
├── database/              ← multi-tenant Postgres design (DDL, seed, loader)
├── docs/
│   ├── README.md          ← what we're building (build overview)
│   ├── modules/           ← one doc per module (the breakdown)
│   └── design/            ← design notes (e.g. mockup-feature-gaps.md) + mockups
└── (planned)
    ├── apps/admin/        ← Admin Portal  (SvelteKit → Cloudflare Pages)
    ├── apps/desktop/      ← Member Console (Tauri + SvelteKit)
    ├── apps/site/         ← Marketing site (SvelteKit → Cloudflare Pages)
    ├── services/gateway/  ← Central gateway (Rust + Axum, wraps the gateway crate)
    ├── packages/ui/       ← shared design system + components
    └── supabase/          ← schema, RLS policies, edge functions, migrations
```

The new Rust gateway crates (`gateway`, `gateway-embedded`) currently live in `sensei-hq/sensei/crates/` and are referenced by the central service and the desktop app.

## Status

**Design phase.** Requirements and architecture are being written before code. Start with **[`docs/README.md`](docs/README.md)**, then the per-module breakdown in **[`docs/modules/`](docs/modules/)**. The archived previous implementation (Node/TS) lives in `../strategos_old/`.
