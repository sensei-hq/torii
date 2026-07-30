# Pass 1 — autonomous frontend-depth build

> **Scope:** screen depth that wires **already-existing** gateway endpoints into cards/columns the
> audits flag as missing. No new backend, no product decisions. Each screen is one resilient
> checkpoint: build → `bun run check` 0/0 → `bun run test` green → Svelte autofixer → commit.
> Build protocol: [`../design/SCREEN-BUILD-RUNBOOK.md`](../design/SCREEN-BUILD-RUNBOOK.md).
> Audits: [`../specs/seiki-screens/README.md`](../specs/seiki-screens/README.md) ·
> [`../specs/torii-screens/README.md`](../specs/torii-screens/README.md).
> Backend surface is confirmed to already exist for every item below (2026-07-30 map).

## Rules for every screen
- Named tokens + `@rokkit/ui` only (inherit the done foundation — no hex/oklch/rgba, no re-tuning).
- Three-layer state (Component ← `*-state.svelte.ts` ← Load); the Load fetches **real** data via
  `$lib/api` (the endpoint exists). Add thin `api.ts` wrappers only over routes that already exist.
- Contract tests (assert what the consumer needs, not current output — avoid the false-green trap).
- Commit ONLY that screen's files. If you can't reach green, `git checkout` your changes and report
  failure — leave the tree clean for the next screen. Don't touch other screens' files.

## Seiki (admin, `apps/admin`) — mockups `docs/mockups/app/view-*.jsx`
| # | Screen | Existing endpoints to wire | Missing depth to build | Mock |
|---|---|---|---|---|
| 1 | Overview | `/v1/requests`, `/v1/budgets`, `/v1/connections`, `/v1/models`, `/v1/routing` | hero-insight tile, exec-plane (local vs cloud via `execution_location`) split, setup-spine checklist, cost-trend sparkline (from `recorded_at`+`cost_usd`) | `view-overview.jsx` |
| 2 | Requests & audit | `/v1/requests`, `/v1/budgets`, `/rpc/budgets/request` | exception grouping/triage (group by `status`), member budget cascade, request-increase action, CSV export | `view-requests.jsx` |
| 3 | Features | `/rpc/governance/set-feature` (already accepts `space`/`role` scope) | space/role scope switcher (client currently hardcodes `scope_type:'workspace'` in `api.ts`) | `view-features.jsx` |
| 4 | Governance | `/v1/devices`, `/v1/audit` | device-fleet card + audit/SIEM card (reuse existing reads) | `view-governance.jsx` |
| 5 | Budgets & billing | `/v1/requests` | provider/model cost breakdown (aggregate `adapter`/`model`/`cost_usd`). Billing itself stays deferred (DECISIONS §10.1) | `view-billing.jsx` |

## Torii (desktop, `apps/desktop`) — mockups `docs/mockups/app/view-*.jsx`
| # | Screen | Existing endpoints to wire | Missing depth to build | Mock |
|---|---|---|---|---|
| 6 | Workspace (home) | `/v1/models/available`, `gateway_status` (Tauri) | "models you can use" list, offline banner, quick-actions | `view-workspace.jsx` |
| 7 | Ask | `cloudInfer(opts.model)`, plane/reason known client-side, `duration_ms` on result | pinned-model control, routing-reason line, latency meter (NOT retrieval — that's Pass C) | `view-ask.jsx` |
| 8 | Playground | `/v1/judge`, cost/latency on `InferResult` | judge verdict panel, cost + latency meters (NOT the RAG rail — Pass C) | `view-playground.jsx` |
| 9 | Activity | `/v1/budgets` (defined in `api.ts` but never called), `/rpc/budgets/request` | budget ceiling + cascade, request-increase flow, filters, CSV | `view-*` (You/Activity) |
| 10 | Settings | client-local (localStorage) — no endpoint needed | theme toggle, local answering prefs surface | `view-*` (You/Settings) |

## Out of this pass
- **Compare** — already DONE (cosmetic only).
- Anything needing new backend → **Pass 2** (Alerts, Onboarding wizard, why-model trace, Models/
  Routing/Connections depth, Spaces&KB, Templates, Tools enforcement, Local-model Tauri cmds).
- **RAG/P7** → **Pass 3** (gated on infra/prereqs). See memory `project-unattended-screen-passes`.

## Verify harness
Per-screen: `bun run check` + `bun run test` + autofixer (no browser needed for data wiring).
End-of-pass: full e2e (`bun run --filter @seiki/admin test:e2e`, needs gateway :8787 + Supabase
:55321 + seed owner) + optional measurement pass vs mockup (`:8890/Seiki.html`) per the runbook.
