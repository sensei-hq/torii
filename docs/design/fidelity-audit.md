# Seiki UI fidelity audit — app vs mockup

> **Status:** in progress (living doc). Method + design-tokens + shell measured; 9 per-screen
> catalogs pending. Fixes deferred until the catalog is complete (per the agreed plan).

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
- ✅ **DONE (`6b76d52`): `text-[11px]` × 79 (63 admin + 16 ui) → `text-xs`.** Confirmed scale:
  `text-xs`=12px, `text-sm`=14px. So eyebrows/meta snapped 11→12px (on-scale, per grid-over-pixel).
- Remaining off-grid sizes: `text-[10px]`×5, `text-[13px]`×2 → nearest stop; `text-[28px]`×1 (a
  heading) → a scale stop / `zs-h` role.
- **~35 half-step spacings off the 4px grid** — `py-1.5`×13, `px-2.5`×7, `py-2.5`×4, `p-0.5`×3,
  `gap-1.5`×3, `py-0.5`, `gap-0.5`, `gap-2.5` (all ±2px increments).
- Arbitrary dimensions — `w-[18px]`/`h-[18px]` (icons → a size token), `w-[400px]`/`w-[460px]`/
  `w-[1100px]` (layout max-widths).

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

| Token | Mockup | App | Note |
|---|---|---|---|
| `--paper-edge` (light) | `oklch(0.880 0.015 85)` | `oklch(0.85 0.01 70)` | app edge is darker, lower-chroma, cooler hue (70 vs 85) — every hairline border is off |
| `--accent-soft` (dark) | alpha accent `oklch(… / 0.12)` (runbook: alpha in **both** modes) | solid tint `oklch(0.940 0.040 35)` | app uses a solid light tint, not the mockup's translucent accent |

*(Both are token-config fixes — global, do once, re-verify globally. Confirm the mockup values are
the intended spec before changing.)*

## Shell — rail + nav (measured, light)
| Element · property | Mockup (spec) | App | Drift |
|---|---|---|---|
| Rail background | `oklch(0.975 0.008 85)` (**paper**) | `oklch(0.955 0.01 85)` (**paper-soft**) | rail a shade greyer |
| Rail width | 248px | 240px | −8px |
| Rail border-right | `oklch(0.88 0.015 85)` | `oklch(0.85 0.01 70)` | the `paper-edge` drift above |
| Nav item font-size | 13px | 14px | +1px |
| Nav item font-weight | 500 | 400 | lighter |
| Nav item inactive color | `ink` (0.22) | `ink-soft` (0.38) | app greyer |
| Nav item padding | 7px 12px | 6px 8px | tighter |
| Nav item radius | 6px | 6px | ✅ |
| Active pill bg / color / radius | `oklch(0.92 0.012 85)` / ink / 6px | **same** | ✅ |

**Shell fixes (app `packages/ui` `NavRail` + rail container) — expressed on the grid:** nav items →
the ~13px scale stop (`text-sm`, confirm the stop) + `font-medium` + `text-ink`, padding `px-3 py-2`
(grid; snapped from the mockup's off-grid `7px`); rail bg `paper` (not `paper-soft`); rail width to a
grid value (`w-60`=240 or `w-62`; the mockup's 248 is off-grid → pick the nearest stop); border via
the corrected `paper-edge` token. No bracket values.

**Pending in the shell:** the Chrome **header** (mockup Chrome isn't a `<header>` el — needs a
targeted selector; app header is the 42px `bg-paper` bar with traffic-light dots + centered title).

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
