# Modules

The product, broken into modules. Each module has its own doc here that states purpose, responsibilities, what to build, key contracts, UI surfaces, and open questions — and later expands into a full spec → plan → implementation.

**Planes:** **F** Foundations (shared) · **C** Central gateway (cloud) · **D** Device runtime (Tauri) · **W** Web / clients · **O** Observability & ops · **X** Cross-cutting (Tools/MCP, Agents). All scope decisions are resolved in [`../DECISIONS.md`](../DECISIONS.md).

## Index

| #                                     | Module                                 | Plane       | Purpose                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [F1](F1-data-model.md)                | Data model & schema                    | Foundations | Multi-tenant Postgres schema (RLS, dbd-managed): orgs, people, roles, providers/models/routers, chains, budget tree, key vault, spaces/documents, sessions, tasks/logs, audit, settings. |
| [F2](F2-identity-auth-rbac.md)        | Identity, Auth & RBAC                  | Foundations | Supabase Auth (email/OAuth → SSO/SCIM), JWT, roles & permissions, RLS policies, device enrollment.                                                                                       |
| [F3](F3-key-vault.md)                 | Key vault & crypto                     | Foundations | BYOK storage with DEK/KEK envelope encryption; rotate/revoke; never exposed to clients.                                                                                                  |
| [C1](C1-gateway-service.md)           | Gateway service & API                  | Central     | Axum service wrapping the `gateway` crate; JWT auth + tenant scoping; chat/embed/etc. endpoints; SSE; `GatewayStore`→Postgres.                                                           |
| [C2](C2-routing-resilience.md)        | Routing, chains & resilience           | Central     | Fallback chains, circuit breaker, budget filtering, cloud adapters; chain CRUD + per-space/role binding.                                                                                 |
| [C3](C3-budgets-metering.md)          | Budgets, metering & reconciliation     | Central     | Authoritative spend, cascading caps (org→dept→team→user), hard/soft limits, alerts, device usage reconciliation.                                                                         |
| [C4](C4-governance-runtime.md)        | Governance runtime                     | Central     | Guardrails / PII & tenant masking, grounded-only, confidentiality enforcement, "why-this-model" trace + audit emission.                                                                  |
| [C5](C5-rag-document-intelligence.md) | RAG & document intelligence            | Central     | Ingestion → markdown-first extraction → chunking → embeddings → hybrid retrieval + rerank; document management & storage.                                                                |
| [C6](C6-quality-signals.md)           | Quality signals & interaction intelligence | Central | Capture explicit+implicit quality signals → audit/analytics + live meters (v1); adaptive conversation go-between (v2; screens designed in v1). Placement provisional — see [`../DECISIONS.md`](../DECISIONS.md) §3b.  |
| [D1](D1-desktop-shell.md)             | Desktop shell & local store            | Device      | Tauri 2 shell, IPC commands/events, embedded Postgres/SQLite, OS keychain, tray/menus.                                                                                                   |
| [D2](D2-local-gateway.md)             | Embedded local gateway & model manager | Device      | In-process `sensei-local-*` (`EmbeddedLlamaAdapter` llama.cpp / `OrtAdapter` ONNX; no daemon; fastembed disabled) + model registry/download/GC.                                            |
| [D3](D3-split-plane-router.md)        | Split-plane router                     | Device      | Decide local vs central per request/step; proxy cloud steps to C1; merge into one response/trace.                                                                                        |
| [D4](D4-config-sync.md)               | Config sync & offline                  | Device      | Supabase Realtime subscribe + versioned pull + hot-reload; offline cache; usage/audit upload buffer.                                                                                     |
| [W1](W1-admin-portal.md)              | Admin Portal                           | Web         | `admin.` — connections, models, routing, organization, governance, billing, onboarding, settings.                                                                                        |
| [W2](W2-member-console.md)            | Member Console                         | Web         | `app.` — workspace, ask, library, activity; reused inside the desktop app.                                                                                                               |
| [W3](W3-playground.md)                | Playground & retrieval lab             | Web         | "Show by example" — retrieval-mode selector, pipeline toggles, inspector, live meters, model compare.                                                                                    |
| [W4](W4-design-system.md)             | Design system & shared UI              | Web         | Rokkit-based component library, semantic styles, skins, command palette — shared by all UIs.                                                                                             |
| [W5](W5-marketing-site.md)            | Marketing site                         | Web         | `strategos.` — hero, controls, pricing, talk-to-sales.                                                                                                                                   |
| [O1](O1-ledger-audit.md)              | Request ledger, audit & SIEM           | Ops         | Unified call ledger across planes; immutable audit; SIEM streaming; export.                                                                                                              |
| [O2](O2-analytics.md)                 | Analytics & cost insights              | Ops         | Cost trends, model mix, local-vs-cloud savings, fallbacks, dashboards.                                                                                                                   |
| [O3](O3-device-fleet.md)              | Device fleet & feature governance      | Ops         | Enrolled-device management + per-feature `locked/default/user-overridable` governance.                                                                                                   |
| [X1](X1-tools-mcp.md)                 | Tools & MCP                            | X (v1)      | **In v1.** MCP registry (stdio on device, http/sse shared) + per-(role×space) tool allow-lists; gateway enforces at tool-call time (SSRF-filter http, sandbox stdio).                     |
| [X2](X2-agents-plans.md)              | Agents & plans                         | X (design)  | **Design-only in v1** (Workflows + agent-builder screens exist); ReAct + DAG + HITL runtime deferred to v2 — no runtime tables in v1.                                                     |

## Dependencies & build order

```
F1 ─┬─▶ F2 ─┬─▶ C1 ─┬─▶ C2 ─▶ C3
    │       │       ├─▶ C4
    └─▶ F3 ─┘       └─▶ C5        (F3 vault MUST precede C1 handling any real provider key)
                         │
W4 (design system) ──────┼─▶ W1, W2, W3, W5
                         │
Device foundation: D1, D2 built first (Phase 1)
C1 ─▶ D4 ;  { C1, D2, D4 } ─▶ D3   (split-plane router needs the central gateway + local engine + config sync)
X1 (tools/MCP): C1 + W1 · X2 (agents, design-only): W screens
C6 (quality signals): { C1, C4 } ─▶ C6 ─▶ O1, O2
O1/O2 consume C1/C3/C4/C6 outputs · O3 builds on F2 + D4
```

**Suggested first slice (vertical, thin):** F1 → F2 → F3 → C1 (chat passthrough with one provider) → W4 + W2 (ask) → C5 (basic RAG) → C3 (budgets) → C4 (masking/audit). Then the desktop plane (D1–D4) and the rest of the admin surfaces.

## Status

All scope decisions are **resolved** in [`../DECISIONS.md`](../DECISIONS.md) (2026-07-23). **F1 is built** in [`database/`](../../database/) but needs a **security + role-matrix rework** (see [`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md)); the other modules are seeds being expanded to full spec → plan. X1 (Tools/MCP) is in v1; X2 (Agents) is design-only in v1.
