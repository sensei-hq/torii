# Mockup review — corrections spec

**Date:** 2026-07-30 · **Scope:** `docs/mockups/app/` (Seiki + Torii mocks, post pure-UnoCSS refactor)
**Purpose:** corrections to apply to the **mocks** before app dev resumes. The mock is the app's
source of truth, so fixing these first avoids rework downstream. Reviewed for internal correctness
and against the app's design tokens.

Line numbers are as of this review; if the files shifted, search the quoted snippet.

---

## ✅ Confirmed correct — please DON'T change these

These were verified and are right; listing them so they aren't "cleaned up" by mistake:

- **Design tokens match the app exactly** (`zs.css`): type scale `--text-xs…4xl` = 11/13/15/17/22/28/40/56; radii 6 / 10; dark `--paper-edge` = `oklch(0.300 …)`; ink & paper ramps; accent `oklch(0.580 0.150 35)`. No drift.
- **Spacing already uses UnoCSS defaults.** `theme` defines no custom `spacing`, so `p-6`=24px, `px-6 py-4`=24/16, `mb-8`=32px behave identically in the mock and the app. This is the desired behaviour — keep it (see cleanup #3 for the one leftover).
- **Preflight resets are `:where()`-wrapped** (0 specificity), so utility classes always win — e.g. `:where(.zs button){ background:none }` can't override `bg-ink`. No `!important` anywhere. This is correct and prevents an "invisible button" class of bug.

---

## 🔴 Must-fix bugs (2)

### 1. `animate-popfast` has no keyframe → workflow popover has no entrance animation
`app/uno.config.js` — the `wf-pop` shortcut (~line 363) uses `animate-popfast`, and
`theme.animation.durations`/`timingFns` (~lines 67–68) both define `popfast`, but
`theme.animation.keyframes` (~lines 60–66) has **no `popfast` key**. UnoCSS only emits the
animation when the keyframe exists, so `animate-popfast` produces nothing.

**Fix** — add to `theme.animation.keyframes`:
```js
popfast: '{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}',
```

### 2. `view-billing.jsx` budget-tree `team` rows render a fallback ❓ icon
`app/view-billing.jsx` ~line 20: `const KIND_IC = { org:'org', dept:'dept', user:'user' }` is
missing `team`. `BillingView` flattens `BUDGET_TREE`, which contains `kind:'team'` nodes
(Maintenance / Leasing / Tier-1), so `<Icon name={KIND_IC[node.kind]} />` (~line 112) gets
`undefined` → renders `question-circle`.

**Fix** — add the key (the `team` glyph exists in `icons.jsx`, and `view-organization.jsx`'s
`KIND_ICON` already includes it):
```js
const KIND_IC = { org:'org', dept:'dept', team:'team', user:'user' }
```

---

## 🟡 Dark-mode + cleanup (recommended)

### 3. Delete the dead `--space-*` scale from `zs.css`
`zs.css` (~lines 79–88) declares `--space-0 … --space-9` as a **non-linear** scale (…24/32/48/64).
Nothing reads it — the shortcuts use UnoCSS's default 4px spacing. Worse, it's *misleading*:
`--space-6` says 32px but the real `p-6` is 24px. **Remove `--space-0…9`.** (This is the "fix the
scale / use default" item — the default is already in effect; just drop the vestigial tokens.)

### 4. Dark mode: raw-`oklch()` theme colors don't flip
In `app/uno.config.js` `theme.colors`, several values are literal `oklch(...)` instead of
`var(--…)`, so they won't change under `[data-theme="dark"]`: `ink.hover` (~line 18),
`warning.ink` (~21), all `line.*` (~26–38), `traffic` (~39), `scrim` (~23), `schedule` (~24).
The one with a **visible** dark-mode defect: `zs-btn-primary` (~line 95) `hover:bg-ink-hover` — in
dark mode the button base is light but hover jumps to a fixed dark, inverting wrong.

**Fix** — at minimum, make `--ink-hover` a token in `zs.css` with a `[data-theme="dark"]` value and
reference `var(--ink-hover)` in the theme. (Auditing the other literals for dark is optional — they
only matter if/when those surfaces are viewed in dark mode.)

### 5. Dead `--tracking-*` / `--leading-*` tokens (same family as #3)
`zs.css` declares `--tracking-tight/-normal/-wide` (~74–76) and `--leading-*` (~69–72), but `theme`
wires no `letterSpacing`/`lineHeight`, so shortcuts hardcode `tracking-[0.18em]`,
`tracking-[-0.02em]`, `leading-[1.2]`, etc. Output is correct; the tokens are decorative.
**Fix (choose one):** either wire them into `theme.letterSpacing`/`theme.lineHeight` and swap the
arbitrary values for named utilities (`tracking-wide`, `leading-tight`), **or** delete the unused
tokens. Wiring `letterSpacing.wide = var(--tracking-wide)` (0.18em) is nice because it lets the app
share the exact same named utility.

### 6. Four hand-rolled tables bypass the `Table` kit → don't stack on mobile
CLAUDE.md says "never hand-roll a table — use the kit." These use `<table className="tbl">` and so
skip the kit's responsive stacking:
- `view-governance.jsx` ~line 349 (Ownership table)
- `view-governance.jsx` ~line 399 (Effective-policy-per-member)
- `view-organization.jsx` ~line 279 (groups → roles map)
- `view-organization.jsx` ~line 358 (RolesMatrix) — **plausibly intentional** (a permission matrix
  shouldn't stack); confirm and leave if so.

**Fix** — route the first three through `<Table>` (as the other admin tables do).

### 7. Minor
- Preflight comment (~line 406) says "every reset is wrapped in `:where()`" — `html/body` and
  `::-webkit-scrollbar*` aren't, but they can't be utility-targeted, so it's just a comment nit.
- Redundant custom `rules: [['tabular-nums', …]]` (~74–76) duplicates presetUno's built-in.
- Dead imports: `view-routing.jsx:7` imports `Tag, ExecBadge` (unused).

---

## For app-dev alignment later (NOT mock corrections — noted for context)

The mock now defines a **shortcut vocabulary** (`card`, `card-hd`, `stat`, `zs-btn`, `zs-eyebrow`,
`pill`, `exec`, `nav`, `page-hd` …). When app dev resumes, the app should adopt the **same shortcuts**
in its own `uno.config` so a screen is built with the exact classes the mock uses. Two app-side token
gaps to close then (mock is the reference, so no mock change needed):
- App `accent-soft` should be the alpha value the mock uses (`oklch(0.580 0.150 35 / 0.12)`,
  `zs.css:43`); the app currently has a solid tint.
- Eyebrow letter-spacing naming: the mock uses `tracking-[0.18em]` (or `tracking-wide` if #5 is
  tokenised); the app uses `tracking-widest`. Align on one name.
