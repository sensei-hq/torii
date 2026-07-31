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
| Models | `/models` | ✅ done | 3/3 | single catalog table + provider filter; economics/CRUD deferred |
| Routing | `/routing` | ✅ header | 2/2 | real chains + step toggle; editor/policy/health deferred |
| Connections | `/connections` | ✅ done | 3/3 | real BYOK vault (connect/rotate/revoke/OAuth); custody/scope/add-router deferred |
| Tools & MCP | `/tools` | ⬜ | — | ⚠ allow-lists stored but NOT enforced at inference (security) |
| Governance | `/governance` | ✅ header | 2/2 | real feature-gov + fleet + audit; DLP/policy editors deferred (P6) |
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

### Routing — deferred depth (backend not built) — "Routing reorder/policy/health" (Pass-2)
Header + real read-only chains (order, router, model, plane) + live step enable/disable are done.
Deferred (mock is a full editor; gateway is read + toggle only):
- **Chain EDITOR** — reorder / add / remove steps, per-step model & role & rule & plane edit, new chain.
- **Routing POLICY** — retry budget, backoff, hard timeout, region pin, health-check interval (no read/write).
- **Provider HEALTH** list — needs a health-probe backend.
- **Chain assignments** (scope/role → chain) + budget-remaining simulator.

### Governance — deferred depth (DLP-P6 + policy-model backend)
Header + the three REAL cards (feature-governance 4-state posture with scope switcher · device
fleet from /v1/devices · immutable audit trail from /v1/audit with category triage + CSV) are done.
The mock has 8 more cards, all needing a backend that isn't built:
- **Policy enforcement · live** (applied/blocked counts + block drill-down + reinforce/false-positive feedback).
- **Confidentiality** classification scheme editor · **Masking policy** editor · **Redaction rules** (RE2)
  editor · **Safe-term allow-list** — DLP redactor is P6 (C4).
- **Retention & data rights** (per-type retention + legal hold + subject export/erase) — needs the doc system.
- **Ownership** by space + **Security** posture tiles + **Effective policy · per member** (workspace→space→
  user resolution) — need the policy engine + spaces backend.
Note: app title kept honest ("Feature governance") rather than the mock's grander
"Ownership, security & confidentiality" which describes the unbuilt cards.

### FOUNDATION — table-header micro-typography (systematic, affects every table screen)
The mock renders table column headers at **10px JetBrains Mono uppercase**; the app foundation
type scale is 11-based on-grid (xs=11, no 10px step) and the `grid-consistency` guard forbids
off-grid `text-[Npx]`. App table headers now match the mock's **mono family + uppercase** at
text-xs (11px). The remaining 1px size gap is a **foundation decision** to make once (add a
`2xs`/`th` treatment to `type-scale.js` + update the grid guard, or accept 11px) — not per-screen
drift. Harness deliberately does not assert table-header font-size.

### Models — deferred depth (backend not built)
- Economics columns **tier / $-per-1M / quality / latency** — not in `ModelRow`; need a per-tenant
  catalog-metadata backend. Shown as a foot note, not faked.
- **Add / Edit custom model + Refresh-from-routers** — model-CRUD RPC (Pass-2 "Models add/edit/refresh").
- **Enable-for-scope** (space/role tighten-only) — Pass-2. (Global enable/disable IS live + enforced.)
- **Local-capable** flag — derivable from a keyless/local router; deferred to avoid a second fetch.


### Organization — DEFERRED (needs a product decision, not a mechanical fidelity fix)
The mock (`view-organization.jsx`, "Hierarchy & budgets") and the app ("People & access")
have **diverged in purpose**, so a fidelity role table would fail on nearly every anchor:
- **Mock centers on an editable budget-hierarchy tree** (org→dept→team→user: rename, per-node
  cap edit, D/W/M enforcement window, hard/soft + alert% + free-floor policy popover, add/remove
  levels, alloc-vs-cap over-allocation). That's a large interactive feature wired to the budget
  upsert RPC — a real build, not a polish. The app's Organization has **no budget tree** today.
- **Mock's SSO/SCIM "Identity & directory" card is explicitly `fast-follow` / "not yet enabled"**
  in the mock itself — a faithful reproduction is a *designed-but-disabled* card (SAML/SCIM aren't built).
- **App was reshaped by ratified DECISIONS §10.3** — API identities were MOVED into Organization
  (this session's first task). The mock predates that and has no API-identities card (its People
  footer just points at "API identities" as elsewhere). So mock ≠ app by decision.
- **App already ships real, secure RBAC** here: members + assign/unassign role, transfer-ownership,
  issue/revoke API keys (reveal-once), duplicate-to-customize custom roles, permission matrix — all
  real writes. Not worth disturbing for cosmetic mock-match.
**To revisit (product call needed):** does Organization own the editable budget tree, or does
`/billing`? Reconcile §10.3 (API identities) vs the mock. Then build the tree against the budget
upsert RPC as its own task. Cheap wins meanwhile: page padding `px-5 pb-6`→responsive
`px-4 sm:px-6 xl:px-12 pb-12`, `space-y-4`→`space-y-6`, card-row `px-4`→`px-6`.
