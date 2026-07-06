# Modules

The product, broken into modules. Each module has its own doc here that states purpose, responsibilities, what to build, key contracts, UI surfaces, and open questions — and later expands into a full spec → plan → implementation.

**Planes:** **F** Foundations (shared) · **C** Central gateway (cloud) · **D** Device runtime (Tauri) · **W** Web / clients · **O** Observability & ops · **X** Pending decision.

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
| [D1](D1-desktop-shell.md)             | Desktop shell & local store            | Device      | Tauri 2 shell, IPC commands/events, embedded Postgres/SQLite, OS keychain, tray/menus.                                                                                                   |
| [D2](D2-local-gateway.md)             | Embedded local gateway & model manager | Device      | `gateway-embedded` (llama.cpp/ORT/fastembed) + model registry/download/GC.                                                                                                               |
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
| [X1](X1-tools-mcp.md)                 | Tools & MCP                            | Pending     | Tool registry + MCP servers (stdio on device, http/sse shared). **Decision #1.**                                                                                                         |
| [X2](X2-agents-plans.md)              | Agents & plans                         | Pending     | ReAct agents + DAG task plans + HITL. **Decision #3.**                                                                                                                                   |

## Dependencies & build order

```
F1 ─┬─▶ F2 ─┬─▶ C1 ─┬─▶ C2 ─▶ C3
    │       │       ├─▶ C4
    └─▶ F3 ─┘       └─▶ C5
                         │
W4 (design system) ──────┼─▶ W1, W2, W3, W5
                         │
C1 ─▶ D4 ─▶ D3 ─┬─▶ D1
                └─▶ D2
O1/O2 consume C1/C3/C4 outputs · O3 builds on F2 + D4
```

**Suggested first slice (vertical, thin):** F1 → F2 → F3 → C1 (chat passthrough with one provider) → W4 + W2 (ask) → C5 (basic RAG) → C3 (budgets) → C4 (masking/audit). Then the desktop plane (D1–D4) and the rest of the admin surfaces.

## Status

All modules are **Planned** (design phase). Each doc is a seed; we expand one into a full spec when we pick it up. Pending-decision modules (X1, X2) and the open scope questions are tracked in [`../README.md`](../README.md#open-decisions).
