# Seiki UI fidelity audit — app vs mockup

> **Status:** in progress (living doc). ✅ **Global foundation fixed** (per "fix foundation first"):
> type scale fully on-grid, `--paper-edge` corrected, shell rail/nav aligned — each committed with a
> regression guard. ⬜ Remaining: `--accent-soft` alpha token (deferred), then the 9 per-screen
> catalogs (where half-step spacing + dimension brackets get snapped with per-screen re-measurement).

## Method (per `sensei/docs/spec/dojo-screens/SCREEN-BUILD-RUNBOOK.md`)
**Verify by MEASUREMENT, not by eye** — the diffs that matter (13 vs 14px, weight 400 vs 500,
`paper` vs `paper-soft`, a solid tint vs a 12%-alpha accent, hue 70 vs 85) are invisible in a
screenshot. So for every screen:
1. Render both in parallel — **mockup** at `http://localhost:8890/Seiki.html` (served from
   `docs/mockups`; sign in via the "Email me a magic link" button after selecting the Aiko/admin
   persona — the persona buttons only `setSel`, the magic-link button calls `onSignIn`), and the
   **app** at `http://localhost:5273` (authed).
2. Match modes (both light or both dark).
3. Drive both to the same screen, then read **computed** styles with Playwright `browser_evaluate`
   + `getComputedStyle` and **diff the numbers**. Reusable snippet at the bottom.
4. Fixes are **usage bugs** (wrong token/utility in a component) unless a `--token` value itself
   drifts — then fix the token config once, globally (`packages/ui/rokkit.config.js` /
   `tokens.css`) and re-verify globally.

Everything named below is a real `oklch()` computed value read live on 2026-07-29.

## Consistency: grid / type scale / spacing (SYSTEMIC — fix FIRST)
The scale comes from `@rokkit/unocss` `presetRokkit` (`packages/ui/uno.config.js` + `rokkit.config.js`)
— a named type scale (`text-xs`…`text-4xl`), a **4px spacing grid** (`p-*`/`gap-*` = N×4px), and radii
stops. But the app **bypasses it with arbitrary bracket values — 83 occurrences in `apps/admin/src`** —
which is the root of the "random inconsistent numbers":
- ✅ **TYPE SCALE FULLY ON-GRID** (`6b76d52` + `8a9c638`). Confirmed live scale: `text-xs`=12 /
  `text-sm`=14 / `text-base`=16 / `text-lg`=18 / `text-xl`=20 / `text-2xl`=24 / `text-3xl`=30
  (no `2xs`/`md`/`4xl`). Snapped: `text-[11px]`×79→`text-xs`; then `[9px]`/`[10px]`→`text-xs`
  (nothing below 12), `[13px]`→`text-sm`, `[17px]`→`text-lg`, `[28px]`→`text-3xl`. **0 off-grid
  text sizes remain**, locked by `apps/admin/src/lib/grid-consistency.spec.ts`.
- ⬜ **~35 half-step spacings** (`py-1.5`×16, `mt-0.5`×11, `px-2.5`×10, `py-2.5`×5, `p-1.5`×5,
  `mb-1.5`×5 …) → 4px grid. **Deferred to the per-screen pass** — each is a ±2px VISUAL change that
  needs re-measurement in context; a blind global sweep would shift layouts.
- ⬜ **Arbitrary dimensions** — `w-[18px]`/`h-[18px]` (icons → size token), `h-/w-[22px]` (avatars),
  `h-[42px]` (chrome bar), `w-[400/460/1100px]` (layout max-widths). Per-screen pass.

**Fix (foundation — do BEFORE per-screen polish, else fixes just add more off-grid numbers):**
1. Confirm presetRokkit's stops (fontSize + spacing + radii) = the single scale everything snaps to.
2. Replace bracket values with scale utilities: `text-[11px]`→`text-xs` (or `zs-meta`/`zs-eyebrow`),
   half-steps → the nearest grid step, icon sizes → a size token. **No `-[..px]` in components**
   (runbook Part A: never a raw px/hex in a component).
3. **Fidelity-vs-grid reconciliation:** the mockup itself has some off-grid numbers (e.g. nav padding
   `7px 12px`). Prioritise the **grid** — match the mockup's visual *hierarchy* but express it on the
   scale (snap `7px`→`8px`/`py-2`), rather than replicating the mockup's arbitrary number. The user's
   directive: a consistent grid over pixel-exact mockup replication.
⚠️ Snapping shifts spacing by ±1–2px — a deliberate, reviewed, re-measured visual change per screen.

## Design tokens (foundation)
The Zen-Sumi system **is** ported — the app exposes every named token (`paper`/`ink`/`accent`/
`primary` + `soft`/`mute`/`edge`/`faint` variants) and the Fraunces / Inter / JetBrains fonts, and
the **dark palette flips correctly** (`paper`→`0.170`, `ink`→`0.940`, `on-primary`→dark). Drifts:

| Token | Mockup | App | Status |
|---|---|---|---|
| `--paper-edge` (light) | `oklch(0.880 0.015 85)` | ✅ **FIXED** (`ca912d8`): `kami.400`→`0.880 0.015 85` | was `0.85 0.01 70` (darker/cooler); verified baked into the build; dark = `sumi.400` unchanged. Guarded by `tokens.spec.svelte.js`. |
| `--accent-soft` | alpha `oklch(0.580 0.150 35 / 0.12)` (both modes) | ⬜ **DEFERRED**: solid `shu.100` (`0.940 0.040 35`) | Mockup = accent @ 12% alpha; app derives a solid tint. NOT a stop remap — needs an explicit `overrides['accent-soft']` alpha value (verify presetRokkit's alpha-override syntax first). Low blast-radius (avatar chips + signin diagram). |

## Shell — rail + nav (`packages/ui/src/lib/AppShell.svelte`) — RE-MEASURED
> The admin shell is **`AppShell.svelte`, NOT `NavRail.svelte`** (NavRail is unused by admin). A
> live re-measure of the mockup's **inactive** nav items corrected the first-pass table: inactive =
> `ink-soft` (0.38) / weight 400 / 13px — identical to the app. The earlier "ink / 500 / 0.22" was
> the **active** item. So font-size / weight / inactive-color are NOT drifts.

| Element · property | Mockup | App | Verdict |
|---|---|---|---|
| Rail background | `paper` (0.975) | was `paper-soft` (0.955) | ✅ FIXED (`378f2fa`) → `bg-paper` |
| Nav item padding | `7px 12px` (off-grid) | was `px-2 py-1.5` (8/6) | ✅ FIXED (`378f2fa`) → `px-3 py-2` (grid-snap) |
| Nav item font-size | 13px (off-grid) | `text-sm` (14) | ✅ keep `text-sm` — grid stop over pixel-exact |
| Nav weight / inactive color | 400 / ink-soft | 400 / ink-soft | ✅ already matches (was an active-item artifact) |
| Active pill | `bg-paper-mute` (0.92) / ink / 6px | same | ✅ matches |
| Rail width | 248px (off-grid) | 240 (`15rem`) | ✅ keep 240 — clean grid stop |
| Rail border | `paper-edge` | fixed via the token above | ✅ |

Both fixes guarded by the extended `AppShell.spec.svelte.js`.

**Pending in the shell:** the Chrome **header** (mockup Chrome isn't a `<header>` el — needs a
targeted selector; app header is the 42px `bg-paper` bar with traffic-light dots + centered title);
plus the shell's own half-step spacings (`gap-2.5`, org-header `px-2.5 py-2`, `mb-1.5` labels) → per-screen pass.

## Per-screen catalog (pending)
Each row: drive both to the screen (same mode), measure page-header (eyebrow/title/sub font+color),
cards (bg/border/radius/pad), stat tiles, buttons, inputs, tables/lists, and any custom component.

| Screen | app route | mockup section | status |
|---|---|---|---|
| Shell (rail/nav) | — | — | ✅ rail/nav done; Chrome header pending |
| Overview | `/` | overview | ⬜ pending |
| Requests & audit | `/requests` | requests | ⬜ pending |
| Organization | `/organization` | admin/org | ⬜ pending (known: "Unnamed"→email fixed; recheck member row) |
| Models | `/models` | models | ⬜ pending |
| Routing | `/routing` | routing | ⬜ pending |
| Connections | `/connections` | connections | ⬜ pending |
| Governance | `/governance` | governance | ⬜ pending (known: 4-state control fixed to `bg-ink/text-paper`; mockup uses per-state colors locked=accent/on=success/off=ink-mute/user=ink — RECHECK) |
| Budgets & billing | `/billing` | billing | ⬜ pending |
| Settings | `/settings` | settings | ⬜ pending |
| Tools & MCP | `/tools` | tools | ⬜ pending |
| Devices | `/devices` | devices | ⬜ pending |

## Reusable measurement snippet (`browser_evaluate`)
```js
() => {
  const m = (el) => { if(!el) return null; const c=getComputedStyle(el), r=el.getBoundingClientRect();
    return { cls:(el.className||'').toString().slice(0,30), w:Math.round(r.width), h:Math.round(r.height),
      bg:c.backgroundColor, color:c.color, border:c.borderWidth+' '+c.borderColor, radius:c.borderRadius,
      font:c.fontFamily.split(',')[0].replace(/['"]/g,''), fs:c.fontSize, fw:c.fontWeight, pad:c.padding, gap:c.gap }; };
  const q = (s) => m(document.querySelector(s));
  return { mode: document.documentElement.getAttribute('data-mode') || document.body.getAttribute('data-mode'),
    // per screen, fill in the semantic selectors for each side:
    h1: q('h1'), eyebrow: q('[class*="eyebrow"]'), card: q('[class*="card"]'),
    button: q('button'), input: q('input') };
}
```
