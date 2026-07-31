# Screen fidelity — autonomous run backlog

Living log of the reproduce-the-mock fidelity pass across the Seiki admin screens.
Method + gotchas: skill `seiki-screen-fidelity`. Each screen: reproduce
`docs/mockups/app/view-<screen>.jsx` element-by-element with REAL data, honestly defer
what needs a backend that doesn't exist, add a fidelity role table (Playwright, measured
vs the live mock at `:8890`), and keep unit coverage > 80% (`bun run test:coverage`).

**Gate per screen:** `check` 0/0 · `test:coverage` ≥80% · Svelte autofixer · `lint` ·
`bunx playwright test fidelity.spec.ts` green · commit.

---

## Status

| Screen | Route | Status | Fidelity | Notes |
| --- | --- | --- | --- | --- |
| Overview | `/` | ✅ done | 5/5 | prior pass |
| Requests | `/requests` | ✅ done | 3/3 | org "usage patterns" lens (`dd845a6`) |
| Organization | `/organization` | ⬜ | — | |
| Models | `/models` | ⬜ | — | |
| Routing | `/routing` | ⬜ | — | |
| Connections | `/connections` | ⬜ | — | |
| Tools & MCP | `/tools` | ⬜ | — | ⚠ allow-lists stored but NOT enforced at inference (security) |
| Governance | `/governance` | ⬜ | — | |
| Budgets & billing | `/billing` | ⬜ | — | |
| Devices | `/devices` | ⬜ | — | |
| Settings | `/settings` | ⬜ | — | |
| Onboarding | `/onboarding` | ⬜ (no route yet) | — | Pass-2 wizard (`onboarding_state` table) |

---

## Deferred to backend (Pass-2 / Pass-3) — do NOT fake

Captured as each screen surfaces a gap that needs a backend that doesn't exist yet.

- **Per-call routing trace (GH-5)** — Requests fallback/step-down/failover classification +
  the "why this model" trace panel; also Torii Ask/Activity. Ratified Pass-2 item #3.
- **Alerts** — `alert.manage` capability + CRUD RPC over `notification_channels`; the Alerts
  admin screen. Ratified Pass-2 item #1.
- **Onboarding wizard** — linear multi-step wizard + `onboarding_state` table. Ratified Pass-2 item #2.
- **Tools & MCP enforcement** — `chat.rs` never reads `tool_allow_lists`; allow-lists are
  stored but not enforced at inference (security gap). Pass-2.
- **Spaces & KB, Templates** — no route + no backend (RAG/P7 territory). Pass-3.

## Gaps / TODOs found during the run

(appended per screen as discovered)
