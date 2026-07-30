---
name: seiki-screen-fidelity
description: Use when building, correcting, or reviewing a torii/seiki app screen (apps/admin, apps/desktop) against its React mockup — a screen "doesn't match the mock", typography / font-weight / spacing / color / radius drift, invisible or mis-styled buttons, or adding a screen's missing sections.
---

# Seiki screen fidelity

## Core principle

**Reproduce the mock element-by-element** (header, sections, order, labels, content) using REAL data — NOT "add the audit's missing depth items". The audit lists _data_ gaps; the mock is the _layout/structure_ source of truth. Both matter, but fidelity-to-mock is the job.

**Verify by MEASUREMENT, not by eye.** Diffs of 16 vs 24 px, weight 600 vs 400, `rounded`(8) vs `rounded-lg`(10), a solid vs an alpha accent, dark-vs-light mode — all invisible in a screenshot. The `fidelity` e2e harness reads `getComputedStyle` on both mock and app and fails on drift. Let it tell you what's wrong; don't guess.

## The foundation is configured ONCE — inherit it, don't re-tune per screen

The Zen-Sumi design system matches the mock's `zs.css`. If a value looks off it's a **usage** bug (wrong utility/token), not a config gap. Foundation lives in `packages/ui`:

| Concern                          | Where                                      | Mock value (measured live)                                                     |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| Type scale                       | `packages/ui/type-scale.js` `fontSize`     | 11 / 13 / 15 / 17 / 22 / 28 / 40 / 56 (xs→4xl)                                 |
| Radius                           | `packages/ui/type-scale.js` `borderRadius` | sm 4 · `rounded` 6 · `rounded-lg` **10** · full                                |
| Card rhythm                      | components + page wrapper                  | card padding **24px** (`p-6`), inter-card gap **24px** (`space-y-6`)           |
| Title (PageHeader h1)            | `PageHeader.svelte`                        | `font-heading text-2xl font-normal` (28px / **400**, Fraunces)                 |
| Eyebrow / stat label / card head | `PageHeader`/`CardHead`/`Stat`             | `text-xs font-medium uppercase tracking-widest` (11px / **500** / 1.98px)      |
| Tracking (letter-spacing)        | `packages/ui/type-scale.js` `letterSpacing` | `tracking-widest` = 0.18em (eyebrows) — semantic, never `tracking-[0.18em]`   |
| Stat number                      | `Stat.svelte`                              | `font-heading text-3xl font-light` (40px / **300**, Fraunces)                  |
| Status tone                      | per component                              | progress/dots use `bg-success`/`bg-warning` (green/amber), NOT `bg-accent`     |
| Colors                           | `rokkit.config.js` + `sumi-palette.js`     | ink 0.22 · ink-mute 0.58 · paper 0.975 · paper-edge 0.88 · accent 0.58/0.15/35 |

Config changes (`type-scale.js`, `uno.config.js`, `rokkit.config.js`) need a `vite dev` restart; `.svelte`/CSS hot-reload.

## Per-screen procedure

1. Read the mock: `docs/mockups/app/view-<screen>.jsx` — note header actions, section order, labels, per-element tones.
2. Reproduce the structure in `apps/<app>/src/routes/(app)/<screen>/+page.svelte`, wiring REAL data (`$lib/api`). Named tokens + `@rokkit/ui` only — no hex/oklch/rgba, no `text-[Npx]`.
3. New features use the three-layer **ui-state-pattern** (`sensei:ui-state-pattern`): Load (`<name>.ts`, pure + tested) ← State (`<name>-state.svelte.ts`, runes + tested) ← Component (`@torii/ui`, presentation + tested). A test per layer.
4. Add the screen's role table to `apps/admin/e2e/fidelity.spec.ts` (anchor each role by text/selector in both app + mock). **Run it — let it fail — that failure list is your work list.**
5. Correct to green. Structural gaps needing backend that doesn't exist → derive from existing reads (see AlertsCard) or defer to the backend pass; say which, don't fake data.
6. Gate: `bun run --filter @seiki/admin check` 0/0 · `test` green · Svelte MCP autofixer on every edited `.svelte` · `bunx playwright test fidelity.spec.ts` green. Commit per screen.

## The verification harness (two layers)

- **Component/config (fast, no browser)** — `packages/ui/src/lib/type-scale.spec.svelte.js` (scale == mock) + `components.spec.svelte.js` (class contracts + snapshots). jsdom can't compute CSS, so it pins _classes_.
- **Page (integration)** — `apps/admin/e2e/fidelity.spec.ts` drives the live mock (`:8890`) + authed app, diffs computed font size/weight/family/**color**/padding/gap/radius per role. `playwright.config` auto-starts the mock server. Extend by adding rows/screens.

## Gotchas (each cost a rework cycle — check them)

| Symptom                                    | Cause / fix                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App "uses thicker fonts", sizes a step off | App inherited presetRokkit's 12-based scale + 600 weights; foundation now overrides — verify `type-scale.js` is wired in the app's `uno.config.js`.                            |
| "Text colors don't match"                  | Almost always **mode** (app defaults **dark**, mock is **light**) or heavy weight — not the tokens (they match). Harness pins light via `ensureLight` + `colorScheme:'light'`. |
| Primary button invisible / no fill         | `@unocss/reset` must be `@import ... layer(base)` in `packages/ui/src/app.css`; unlayered, its `[type="submit"]` reset ties `.bg-primary` and wins.                            |
| Progress bars/dots vermillion              | Mock uses status tones — `bg-success` when done, `bg-warning` while incomplete.                                                                                                |
| Runes `*-state.svelte.ts` won't test       | admin `vitest.config.js` needs the `svelte()` plugin + `*.spec.svelte.ts` in `include`.                                                                                        |
| Card too tight                             | padding `p-6` (24), gap `space-y-6` (24), radius `rounded-lg` (10) — not p-4/space-y-4/8px.                                                                                    |
| Spacing "big diff" but utilities look right | Restart `vite dev` — type/radius/tracking are config (not hot-reloaded); a stale server shows old spacing. NEVER author with `var(--space-*)` (broken shim); use `p-*`/`m-*`. |
| Dark-mode drift (borders too bright, icon tones off) | Harness pins LIGHT — it can't see dark drift. Match modes in BOTH: the dark `--paper-edge` (`sumi.400`) + accent-soft/icon tones must match the mock's dark render. Extend the harness to dark. |

## Files

- Runbook (build protocol): `docs/design/SCREEN-BUILD-RUNBOOK.md` · method + measurement snippet: `docs/design/fidelity-audit.md`
- Audits: `docs/specs/{seiki,torii}-screens/README.md` · mocks: `docs/mockups/app/view-*.jsx` · intent: `docs/mockups/CLAUDE.md`
- Mock server: `cd docs/mockups && python3 -m http.server 8890` → `:8890/Seiki.html` (persona → "Email me a magic link"). Seed owner: memory `project-admin-e2e-seed`.

## Common mistakes

- Building from the mock's _source_ but framed as "add depth items" → plausible screen that doesn't match. Frame it as _reproduce this_.
- Re-tuning colors/sizes/spacing in a component → it's a foundation value; fix once in `packages/ui`, re-verify globally.
- Claiming a match without running the harness. Evidence before assertions — the `fidelity` spec is the evidence.
