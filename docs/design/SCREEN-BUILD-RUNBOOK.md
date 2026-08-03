# Screen-build runbook (torii/seiki)

> Vendored + adapted for this repo from the canonical
> `sensei-hq/sensei/docs/spec/dojo-screens/SCREEN-BUILD-RUNBOOK.md` (so unattended agents scoped to
> `torii` can read it). Same disciplines; paths mapped to this monorepo. Companion to
> [`fidelity-audit.md`](./fidelity-audit.md) (the measurement harness) and the two build-vs-mock
> audits in [`../specs/seiki-screens/README.md`](../specs/seiki-screens/README.md) /
> [`../specs/torii-screens/README.md`](../specs/torii-screens/README.md).

## Path mapping (sensei → torii)
| Sensei runbook | torii equivalent |
|---|---|
| `dojo/src/lib/tokens.css`, `rokkit.config.js`, `uno.config.js` | `packages/ui/{rokkit.config.js,uno.config.js}`, `packages/ui/src/lib/tokens.*` |
| `docs/mockups/Sensei/*` harness | mockup served from `docs/mockups`, `http://localhost:8890/Seiki.html` (persona → **"Email me a magic link"**) |
| app dev server | `apps/admin` → `http://localhost:5273` (Seiki) · `apps/desktop` (Torii) |
| `sensei:ui-state-pattern` | same skill; state modules live beside each `+page.svelte` |
| paraglide `m.*()` copy | this repo's i18n if present; otherwise keep strings centralized, not scattered inline |

## The #1 discipline: verify by MEASUREMENT, not by eye
Spacing (0 vs 8 vs 12px), Inter-vs-system at one weight, solid-vs-12%-alpha `accent-soft`,
`rounded`(6) vs `rounded-lg`(10) are **invisible in a screenshot**. For every screen:
1. Render mockup (`:8890/Seiki.html`) **and** app (`:5273`, authed) in parallel browser tabs.
2. Drive both with Playwright; read **computed** values via `browser_evaluate` + `getComputedStyle`
   (font size/weight/family, color, radius, padding/gap, background, `--token` vars) and **diff the
   numbers**. Reusable snippet at the bottom of `fidelity-audit.md`.
3. Fix at the source, re-measure, repeat. (Harness must force-load Inter via FontFace or it reads
   thinner than the app — invalid comparison.)

> For **data/behavior depth** work (Pass A — wiring real endpoints into cards/columns), the binding
> verification is the state/load/**contract test** + e2e, not pixels: the global token/scale/shell
> foundation is already done (see `fidelity-audit.md`), so using named tokens inherits fidelity. Run
> the measurement loop when you touch layout/spacing, not for pure data wiring.

## Part A — design-system baseline is configured ONCE (inherit, don't re-tune)
Colors/tokens, fonts, type scale (`text-xs`…`text-4xl`), 4px spacing grid, radii
(`rounded-sm`4/`rounded`6/`rounded-lg`10), Solar bold-duotone icons — all set in
`packages/ui/{rokkit.config.js,uno.config.js}` + tokens. A new screen **inherits** them via named
tokens + `text-*`/`p-*`/`gap-*` utilities + rokkit components. If a value looks off it's a **usage**
bug (wrong token/utility), not a config gap. `rokkit.config.js`/`uno.config.js` are read at
dev-server startup — **not** hot-reloaded; changing them needs a `vite dev` restart (CSS + `.svelte`
DO hot-reload).

## Part B — per screen
- **B1 tokens/utilities only** — named tokens (`bg-paper`, `text-ink`, `border-paper-edge`,
  `bg-accent-soft`); **never** a hex/`oklch()`/`rgba()` or `style="padding:var(--space-*)"` in a
  component. Pick the radius by measuring the mock element.
- **B2 reach for `@rokkit/ui`** (`Toggle`, `Button`, `List`, `Tree`, `Select`, `MultiSelect`, `Menu`,
  `Table`, `Range`, `SearchFilter`) — don't hand-roll a tab strip / dropdown / table. Rich custom
  cards stay custom. Each screen's spec Build-notes maps controls → component.
- **B3 layout/scroll** — header+body panel: `h-full min-h-0 flex flex-col`, header `shrink-0`, body
  `flex-1 overflow-y-auto`.
- **B4 three-layer state** (`sensei:ui-state-pattern`): Component (pure, reads state, routes intent)
  ← `<screen>-state.svelte.ts` (data + getters + named methods; realtime here) ← `<screen>.ts` **Load**
  (the single seam swapped mock→real). For Pass A the real endpoint EXISTS, so Load fetches real data
  directly via `$lib/api`.
- **B5 access axis** — personal surfaces are user-wide across memberships, not single-tenant.
- **B6 tests assert the CONTRACT the next layer needs, not current output.** The false-green trap:
  a test that enshrines today's (buggy) output blocks nothing. Write it against the requirement so it
  fails on a wrong impl. Test the cross-boundary SEAM (producer output carries what the consumer needs).
- **B7 pre-commit gate (zero-errors):** `bun run check` → **0/0** · `bun run test` → green · Svelte
  MCP autofixer on **every** edited `.svelte`. Browse `http://localhost:…`, not `127.0.0.1`.

## Serving the mockup (for the measurement loop)
`cd docs/mockups && python3 -m http.server 8890`  → then `http://localhost:8890/Seiki.html`.
App: `bun run --filter @seiki/admin dev` (:5273). Seed owner + auth: see memory `project-admin-e2e-seed`.
