# W4 · Design system & shared UI — Spec

**Module:** [W4](../modules/W4-design-system.md) · **Status:** Planned (partially built — Phase 0/1a shell atoms exist) · **Plane:** Web (shared by desktop) · **Tech:** Svelte 5 + Rokkit + UnoCSS `presetRokkit`
**Depends on:** none (root of the UI stack) · **Enables:** W1 (admin portal), W2 (member console), W3 (playground), W5 (marketing, lightly)
**Date:** 2026-07-23 · Reconciled to [`../DECISIONS.md`](../DECISIONS.md) (§6 designer handoff; token vocab ports from `app/zs.css`).

---

> **What this module is.** `@torii/ui` (`packages/ui`) — the single component library and visual
> language every Torii surface consumes. It is a **pure client-side package**: no gateway-crate
> dependency, no HTTP/IPC of its own, no F1 table ownership. Its "contracts" are Svelte component
> props/events, the exported module surface, the UnoCSS/Rokkit token pipeline, and the command
> registry. This spec pins the three residuals the module seed left open (DECISIONS §6, mockup-review
> item 42): the **`zs.css` → Rokkit named-token map**, the **dark-skin palette**, and **how Tauri
> consumes `packages/ui`** — plus the atom-migration plan, semantic styles, skins, and command palette.

> **Blocks W1/W3 builds** (mockup-review #42). The token map + dark palette here are a prerequisite for
> the atom-migration pass, which W1/W2/W3 screens build on.

---

## 1. Purpose & scope

Provide **one** Rokkit-based design system so every UI (admin web app, member console, playground, and
the Tauri desktop app) renders from the same tokens, skins, atoms, and interaction primitives — screens
feel like one product, not per-page. Concretely W4 owns:

- The **token pipeline**: `rokkit.config.js` (palettes → skins → tokens → CSS custom properties) + UnoCSS
  `presetRokkit`, with the named-token vocabulary (`paper`/`ink`/`primary`/`on-primary`/`accent` + soft/
  ladder steps) **ported from `docs/mockups/app/zs.css`** — the authoritative token source (DECISIONS §6).
- **Skins**: a light `zen-sumi` skin (default) and a **`zen-sumi-dark`** skin, both dual-palette; runtime
  switching via `data-skin` + `@rokkit/app`'s theme/skin toggles.
- **Atoms rebuilt Rokkit-native** in a dedicated migration pass (mockup React atoms + `zs.css` component
  classes → Svelte 5 + Rokkit), consumed data-first.
- **Cross-cutting shell primitives** already seeded in Phase 0/1a (TitleBar, NavRail, DesktopShell,
  EnvChip, DeviceFooter, OfflineBanner, ExecBadge, Pill) — this spec brings them under one inventory and
  adds the governance/redaction primitives the ratified surface needs.
- The **command palette** (`mod+k`) via `@rokkit/states` commands + `@rokkit/ui` `CommandPalette`.
- The **packaging + consumption contract** for web (Cloudflare Pages) and Tauri desktop.

**In scope:** tokens, skins, semantic styles, shared atoms/molecules, command palette, package exports,
build/consumption model, the cross-cutting badges/chips/locked-toggle visuals from the ground-rules of
`mockup-review.md`.

**Out of scope:** screen composition and routing (W1/W2/W3/W5 own their screens), business logic, data
fetching, auth (F2/`@torii/core`), any gateway/engine interaction. W4 renders state it is handed; it
never fetches, authorizes, or enforces.

**Non-goal / anti-scope:** W4 must **not** port from `_ds/` (Sensei-branded, numbered `-z{n}` tokens) —
that directory is **reference-only** (DECISIONS §6, mockup-review ground rules). Mine its vocabulary and
behaviour; do not copy its CSS. It must not re-introduce the legacy `-z{n}` z-scale utilities.

---

## 2. Responsibilities

1. **Own the token map** — a stable, documented mapping from the `zs.css` named tokens to Rokkit's
   named-token vocabulary + `overrides:` for the exact OKLCH hues and the 4-step paper/ink ladder Rokkit's
   base set doesn't provide (§8.1).
2. **Own the skins** — `zen-sumi` (light) + `zen-sumi-dark`, defined in `rokkit.config.js`; guarantee both
   satisfy the DECISIONS aesthetic (washi paper / sumi ink / one rationed vermillion accent) and pass
   contrast (§8.2, §9).
3. **Own the atom inventory** — a Rokkit-native component for every mockup atom + `zs.css` component class,
   exported from `@torii/ui`; migration plan + parity checklist (§8.4).
4. **Own the cross-cutting primitives** every screen embeds: execution-location badge, offline banner,
   device/sync chip, desktop-only note, and the **locked-toggle** (governed-control) + **redaction-chip**
   visuals (mockup-review ground rules; items 27/36/38/39/49).
5. **Own the command palette** contract + registry helpers.
6. **Own packaging/consumption** — one export surface, one UnoCSS/skin setup shared by all apps, and the
   ratified Tauri consumption model (§8.3).
7. **Not** own: screens, routes, data, auth, enforcement. W4 is presentational and stateless except for
   ephemeral UI state (open/closed, hover) and the thin theme/skin preference it reads/writes via the host
   app's `user_preferences` store.

---

## 3. Data model (F1 tables owned / used)

W4 **owns no F1 tables** — it is a UI library. It **touches** exactly one, indirectly, via the host app's
data layer (never with its own client):

| Table | Access | Use |
| --- | --- | --- |
| `user_preferences` | read + self-owned write (RLS: `profile_id = auth.uid()`, benign self-owned row per DECISIONS §2 W1 / F1 §5) | Persist the user's **theme** (`light\|dark\|system`), **skin** choice, and **locale** so the `SkinSwitcherToggle` / `ThemeSwitcherToggle` selections survive reload. W4 exposes the toggle components; the **host app** performs the read/write through `@torii/core` — W4 receives the current value as a prop and emits change events. |

W4 renders governed-control state (locked/overridable) and redaction indicators, but the **feature-
governance resolution** (`feature_states`, precedence workspace→space→role→user) and **redaction data**
are computed server-side / by C4/O3 and handed to W4 components as props. W4 stores none of it.

---

## 4. Contracts

W4's contracts are **package/component contracts**, not network contracts. All components are Svelte 5,
runes-based, data-first (`items`, bindable `value`, `fields` field-map, `onchange`/`onselect`), matching
the Rokkit convention (see `rokkit-components` skill).

### 4.1 Package export surface (`@torii/ui`)

`package.json` exports (existing, extended):

```jsonc
{
  "name": "@torii/ui",
  "svelte": "./src/index.js",
  "exports": {
    ".":              { "svelte": "./src/index.js", "default": "./src/index.js" },
    "./app.css":      "./src/app.css",       // base + skin CSS entry (imported once per app)
    "./uno.config":   "./uno.config.js",     // shared UnoCSS preset config
    "./rokkit.config":"./rokkit.config.js"   // shared palette/skin/token config
  }
}
```

Consuming apps re-export the shared config verbatim (already the pattern):
`apps/*/rokkit.config.js` → `export { default } from '@torii/ui/rokkit.config'`, and
`apps/*/uno.config.js` → `presetRokkit(config)`. This guarantees **one** palette/skin/token source.

### 4.2 Component API (representative — the enforceable contract shape)

Cross-cutting primitives (props are the contract; events are `on<verb>` callbacks):

| Component | Props | Events | Notes |
| --- | --- | --- | --- |
| `ExecBadge` | `{ plane: 'local'\|'cloud', region?: string, model?: string }` | — | **Driven by the per-step `plane` column, never inferred from provider/route name** (mockup-review #49; DECISIONS "capability is a MODEL attribute"). Renders "ran on your device" vs "via gateway · {region}". |
| `OfflineBanner` | `{ offline: boolean }` (or reads `env`) | — | "cloud unreachable — local models still work". |
| `DeviceFooter` | `{ synced=true, configVersion=0, localModels=0, offlineBuffer=0 }` | — | sync/config-version/queued chip (as built, Phase 1a). |
| `EnvChip` | `{ env }` | `onchange` | desktop/offline/web state. |
| `DesktopOnlyNote` | `{ feature?: string }` | — | shown for desktop-only capabilities on web. |
| `LockedToggle` (new) | `{ label, value: boolean, state: 'locked'\|'default-on'\|'default-off'\|'user-overridable', reason?: string }` | `onchange` (suppressed when `state==='locked'`) | greyed + lock icon + tooltip(`reason`) when governed; **visual only — not enforcement** (§5). Backs mockup-review items 13/18/33/37. |
| `RedactionChip` (new) | `{ count: number, canReveal?: boolean }` | `onreveal` | "N items redacted" chip; `onreveal` only when `canReveal` (capability-gated by host). Backs items 27/36. |
| `Meter` | `{ label, value, max?, kind?: 'grounding'\|'quality'\|'cost'\|'latency' }` | — | live quality meters (§3b), used by Ask/Playground. |

Foundational Rokkit atoms re-exported/wrapped data-first: `List`, `Tree`, `Select`, `MultiSelect`,
`Table`, `Tabs`, `Toggle`, `Menu`, `CommandPalette` (from `@rokkit/ui`), plus Torii atoms
(`Pill`, `Tag`, `Card`, `CardHead`, `PageHeader`, `Switch`, `ProviderDot`, `ModelPicker`, `CtrlRow`) —
full inventory in §8.4.

### 4.3 Command registry contract

Command palette uses `@rokkit/states` `commands` registry + `@rokkit/ui` `CommandPalette`, bound to
`mod+k` via `@rokkit/actions` (see `command-system-rokkit` skill). W4 exports helpers:

```ts
// registers "Go to {item}" navigation commands; returns an unregister cleanup fn
registerShellCommands({ goto, items }: { goto?: (item: string) => void; items: string[] }): () => void
```

Command shape (Rokkit): `{ id, label, group, keywords[], run(): void, shortcut? }`. Apps register their
own domain commands into the same registry; W4 owns only the shell/navigation set + the palette wiring.
Scope/lifecycle/conflict-detection follow the Rokkit command system (cleanup on `$effect`/`onMount` return).

### 4.4 Token / CSS-variable contract

`presetRokkit(config)` emits CSS custom properties (`--paper`, `--paper-soft`, `--ink`, `--ink-soft`,
`--primary`, `--on-primary`, `--accent`, `--accent-soft`, `--success`, `--warning`, `--danger`,
`--focus-ring`, + the ladder steps from §8.1) and matching utilities (`bg-paper`, `text-ink-mute`,
`border-paper-edge`, …). The active skin is selected by the `data-skin` attribute on a root element (and
`@apply skin-zen-sumi` in `app.css`). **No `-z{n}` numbered utilities** — named tokens only (mockup-review
ground rules; phase-1a note "`data-skin` + named tokens, no `-z{n}`").

---

## 5. Security & RLS

W4 has a **small but real** security surface — it is the *renderer* of enforcement decisions, never the
enforcer:

- **Capabilities / enforcement.** Governed controls render via `LockedToggle` from a **server-resolved**
  governance state (F1 `feature_states`, precedence workspace→space→role→user). The rendered `disabled`/
  `locked` state is **cosmetic**; the actual write is a gateway-mediated privileged mutation (DECISIONS §2
  W1) that C1/the authz API rejects if the caller lacks capability. A user editing the DOM to un-disable a
  toggle changes nothing server-side. W4 must never treat a client-side flag as authorization.
- **Tenant isolation.** W4 holds no tenant data and opens no data connection; all data arrives as props
  from the host app (which is tenant-scoped via RLS/JWT). No component caches cross-request state that
  could bleed between tenants after a user/tenant switch — components are stateless w.r.t. tenant data.
- **Secrets.** No secret, key, token, or provider credential is ever passed to, stored in, or rendered by
  W4. The bundle contains no secrets and no env-embedded credentials (secrets live server-side / in F3).
  `RedactionChip`'s `onreveal` is capability-gated (`canReveal` set by the host from the caller's role);
  the reveal action itself round-trips through the gateway — W4 only fires the event.
- **Redaction (DECISIONS §2 W5).** W4 surfaces the "N items redacted" chip and the what-was-redacted panel
  affordance, but never the raw un-redacted value unless the host supplies it post-authorization. Default
  render shows placeholders only (v1 = one-way placeholders).
- **Exec-location integrity.** `ExecBadge` is driven by the authoritative per-step `plane` value from the
  trace, not a client heuristic (mockup-review #49) — prevents a mislabelled "ran on device" badge.
- **Preference writes.** The only write W4 triggers is the theme/skin/locale `user_preferences` update — a
  self-owned benign row explicitly allowed by RLS (`profile_id = auth.uid()`), performed by the host's
  `@torii/core` client, not W4.

---

## 6. Key flows

1. **App boot & skin selection.** App imports `@torii/ui/app.css` once (base + Rokkit themes + `@apply
   skin-zen-sumi`). Root element gets `data-skin="zen-sumi"` (or `zen-sumi-dark`). `presetRokkit(config)`
   has already emitted the CSS vars at build time; first paint renders with correct tokens (no FOUC).
2. **Theme/skin switch + persist.** User clicks `ThemeSwitcherToggle`/`SkinSwitcherToggle` → `@rokkit/app`
   updates the `vibe` state + `data-skin` attribute (instant, no reload) → W4 emits `onchange` → host app
   writes `{theme|skin|locale}` to `user_preferences` via `@torii/core`. On next boot the host reads
   the preference and passes it as the toggle's initial value. `system` theme follows
   `prefers-color-scheme` until the user overrides.
3. **Command palette.** App calls `registerShellCommands({ goto, items })` in the shell layout (cleanup on
   unmount). User presses `mod+k` (bound via `@rokkit/actions` `shortcuts`) → `CommandPalette` opens →
   fuzzy-filters registered commands → selecting runs `command.run()` (e.g. navigate). Domain screens
   register/unregister their own commands into the same registry on mount/unmount.
4. **Governed-control render.** Host resolves a feature's 4-state governance server-side and passes
   `{state, reason, value}` to `LockedToggle`. If `locked` → greyed + lock icon + tooltip(`reason`), no
   `onchange`. If `user-overridable` → interactive; on change the host issues the gateway-mediated write;
   on server rejection the host reverts the prop and the control snaps back.
5. **Atom migration (build-time flow).** For each mockup atom / `zs.css` component class: (a) build the
   Rokkit-native Svelte 5 component in `packages/ui/src/lib`, (b) style with named tokens only, (c) add a
   `*.spec.svelte.js` render test, (d) validate with the Svelte MCP autofixer, (e) export from
   `src/index.js`. `_ds/` is consulted for vocabulary/behaviour only, never copied.
6. **Dark-mode / offline first paint (desktop).** Desktop is a Tauri static SPA; the skin CSS + fonts must
   be available offline (§10). `data-skin` is set before hydration so the shell paints in the correct
   palette even with no network; `OfflineBanner`/`DeviceFooter` reflect `env.offline`.

---

## 7. Gateway-crate dependencies

**None.** W4 is a pure frontend package (Svelte 5 / Rokkit / UnoCSS). It does not link, call, or depend on
any `sensei-*` crate, and it introduces **no gateway-repo issues** (`docs/plans/gateway-issues.md`
GH-1/2/6/7/8 are all C-plane/engine concerns, none touch W4). Any exec-location or redaction data W4
renders originates from C1/C4/D3 and reaches W4 as props through the host app.

---

## 8. Decisions resolved

### 8.1 `zs.css` → Rokkit named-token map (residual RESOLVED)

The mockup `zs.css` was deliberately authored in Rokkit's **named** vocabulary, so the mapping is near 1:1.
The only structural gap is that Rokkit's base named set provides `{token}` + `{token}-soft`, whereas
`zs.css` uses a **4-step ladder** for paper and ink (`-soft`/`-mute`/`-edge` and `-soft`/`-mute`/`-faint`).
**Decision:** enable the extended token ladder (`tokens: 'extended'`) for the fuller ramp **and** carry the
exact OKLCH values as `overrides:` (the current `rokkit.config.js` already does this for accent/success/
warning/danger). Map:

| `zs.css` token (light) | OKLCH | Rokkit named token / override key |
| --- | --- | --- |
| `--paper` (washi-100) | `oklch(0.975 0.008 85)` | `paper` (surface base) |
| `--paper-soft` (washi-200) | `oklch(0.955 0.010 85)` | `paper-soft` |
| `--paper-mute` (washi-300) | `oklch(0.920 0.012 85)` | `paper-mute` *(override — ladder step)* |
| `--paper-edge` (washi-400) | `oklch(0.880 0.015 85)` | `paper-edge` *(override — hairline)* |
| `--ink` (sumi-900) | `oklch(0.220 0.012 50)` | `ink` (ink base) |
| `--ink-soft` (sumi-700) | `oklch(0.380 0.012 50)` | `ink-soft` |
| `--ink-mute` (sumi-500) | `oklch(0.580 0.010 50)` | `ink-mute` *(override)* |
| `--ink-faint` (sumi-300) | `oklch(0.750 0.008 50)` | `ink-faint` *(override)* |
| `--primary` (= ink) | → `ink` | `primary` (skin `primary: 'stone'`, resolves to ink) |
| `--on-primary` (= paper) | → `paper` | `on-primary` |
| `--accent` (shu-500 朱) | `oklch(0.580 0.150 35)` | `accent` (override — exact vermillion) |
| `--accent-soft` | `oklch(0.580 0.150 35 / 0.12)` | `accent-soft` (override) |
| `--success` (jade-500) | `oklch(0.620 0.080 160)` | `success` (override) |
| `--warning` (amber-500) | `oklch(0.720 0.120 75)` | `warning` (override) |
| `--danger` | `oklch(0.55 0.18 28)` | `danger` (override) |
| `--focus-ring` | `= accent` | `focus-ring` (override) |

Non-color tokens (fonts, `--text-*` scale, `--space-*` 9-stop scale, `--radius-*`, `--shadow-*`, motion
`--ease`/`--dur-*`) are **not** part of the Rokkit palette pipeline — port them as a small `theme.css`
custom-property block imported by `app.css`, preserving the exact `zs.css` values (the 8-size type scale,
9-stop 4px spacing, 4 radii, 3 shadows, hairline-over-shadow rule). The `zs`-prefixed component classes
(`zs-btn`, `zs-badge`, `zs-card`, `zs-input`, `zs-dot`, chrome) are **not** ported as CSS — their behaviour
is rebuilt into the Rokkit-native atoms (§8.4).

**Rationale:** keeps a single source of truth (the mockup) pixel-faithful while using Rokkit's palette
machinery for theming/dark-mode; `overrides:` guarantees exact hues that a named Tailwind palette (`stone`/
`orange` approximation) can't hit. A full custom `vermillion` palette ramp (`palettes:` + `colorSpace:
'oklch'`) is deferred (§10) — not needed until a multi-step accent ramp is required.

### 8.2 Dark-skin palette (residual RESOLVED)

`zs.css` already ships a validated `[data-theme="dark"]` block; port it verbatim into a `zen-sumi-dark`
skin (dual-palette). Values:

| Token | Dark OKLCH |
| --- | --- |
| `paper` | `oklch(0.170 0.010 50)` |
| `paper-soft` | `oklch(0.210 0.012 50)` |
| `paper-mute` | `oklch(0.250 0.012 50)` |
| `paper-edge` | `oklch(0.300 0.010 50)` |
| `ink` | `oklch(0.940 0.008 85)` |
| `ink-soft` | `oklch(0.780 0.008 85)` |
| `ink-mute` | `oklch(0.600 0.010 85)` |
| `ink-faint` | `oklch(0.420 0.012 85)` |
| `accent` | `oklch(0.700 0.150 35)` (brightened for dark) |
| `accent-soft` | `oklch(0.700 0.150 35 / 0.18)` |
| `success` | `oklch(0.720 0.090 160)` |
| `warning` | `oklch(0.780 0.120 75)` |

`primary`/`on-primary` invert with the ladder (primary = ink = light text; on-primary = paper = dark
surface). Implemented as a second skin in `rokkit.config.js` `skins:` (`'zen-sumi-dark'`) selected by
`data-skin`; `theme = system` follows `prefers-color-scheme`.

**Rationale:** the mockup's dark values are already art-directed and contrast-tuned; reusing them avoids
re-deriving a palette and keeps light/dark visually coherent.

### 8.3 Tauri consumes `packages/ui` as a **workspace source dependency**, not a pre-bundled artifact (residual RESOLVED)

**Decision:** the desktop app depends on `@torii/ui` via `"@torii/ui": "workspace:*"` (already the
case in `apps/desktop/package.json`) and imports Svelte **source** — the same as the web apps. There is
**no** separate pre-bundled/compiled UI artifact. Each app runs its own UnoCSS pass over the shared
`presetRokkit(config)` (re-exported from `@torii/ui/rokkit.config`), and Vite/SvelteKit compiles the
`.svelte` sources per app. Rokkit runtime packages stay in `optimizeDeps.exclude` (already configured) so
Vite doesn't pre-bundle them.

**Rationale:** (a) a single UnoCSS/skin pipeline shared verbatim by web + desktop — no token drift between
a "bundled" copy and source; (b) Svelte components must be compiled by the *consuming* app's Svelte
compiler version anyway (pre-bundling `.svelte` is an anti-pattern); (c) tree-shaking works per app;
(d) the desktop static SPA build (`@sveltejs/adapter-static`) already emits a self-contained bundle for
Tauri to load from disk — offline works without a separate artifact. **Trade-off:** the desktop build
compiles UI source itself (marginally slower cold build) — acceptable and already the established Phase
0/1a pattern.

### 8.4 Atom-migration plan + inventory (RESOLVED)

Rebuild every mockup atom (React `atoms.jsx` → `window.StrategosUI`) and every `zs.css` component class as
a Rokkit-native Svelte 5 component in `packages/ui/src/lib`, exported from `src/index.js`, each with a
render spec. `_ds/` is reference-only.

**Already built (Phase 0/1a):** `Pill`, `ExecBadge`, `AppShell`, `EnvChip`, `DeviceFooter`,
`OfflineBanner`, `DesktopOnlyNote`, `TitleBar`, `NavRail`, `DesktopShell`, `commands.ts`.

**To migrate (from `atoms.jsx` + `zs.css` classes):**

| Source atom / class | Target component | Maps to Rokkit primitive |
| --- | --- | --- |
| `Card`, `CardHead`, `.zs-card` | `Card` / `CardHead` | native (paper-soft + edge + radius-lg) |
| `PageHeader` | `PageHeader` | native |
| `Switch`, `.zs-btn` toggle | `Switch` / `Toggle` | `@rokkit/ui` `Toggle` |
| `Tag`, `.zs-badge*` | `Tag` / `Badge` | native (variant = success/warning/accent) |
| `ProviderDot`, `.zs-dot*` | `StatusDot` | native |
| `Meter`, `METER` | `Meter` | native (quality meters, §3b) |
| `ModelPicker` | `ModelPicker` | `@rokkit/ui` `Select` |
| `CtrlRow` | `CtrlRow` | native form row |
| `.zs-btn` / `-primary`/`-secondary`/`-ghost`/`-sm`/`-lg` | `Button` | native (variant + size props) |
| `.zs-input` | `TextInput` | native |
| `.zs-rule` | `Rule` | native hairline |
| `RoutingPanel`, `Sessions`, `Handoff`, `WorkspaceChip`, `SaveSnippetButton` | screen-level (belong to W1/W2/W3, not shared atoms) | — (leave in consuming apps) |
| data-first collections | `List`, `Tree`, `Table`, `Tabs`, `Menu`, `MultiSelect` | `@rokkit/ui` re-exports, data-first |
| **new** governance primitives | `LockedToggle`, `RedactionChip` | native (§4.2, §5) |

Each migrated atom: named tokens only, `*.spec.svelte.js` render test, Svelte MCP autofixer clean,
exported. `RoutingPanel`/`Sessions`/etc. are **screen molecules** and stay with their owning app module.

### 8.5 Semantic styles (RESOLVED)

Adopt the `semantic-styles-rokkit` discipline: components style exclusively with **named tokens** (never
raw hex/oklch inline, never `-z{n}`). Type scale, spacing, radius, shadows come from the ported `theme.css`
custom properties (§8.1). The system's aesthetic rules from `zs.css` are normative: **hairlines over
shadows** (shadows reserved for lifting elements — modals, palettes, hover cards), **air over density**,
**one rationed vermillion accent**. This is the guard against the "every screen slightly different" drift.

### 8.6 Command palette (RESOLVED)

`mod+k` palette via `@rokkit/states` `commands` + `@rokkit/ui` `CommandPalette` + `@rokkit/actions`
`shortcuts`, per the `command-system-rokkit` skill. W4 owns the shell/navigation command set
(`registerShellCommands`) and the palette component wiring in `DesktopShell`; apps register domain commands
into the shared registry. Conflict detection + i18n follow the Rokkit command system.

---

## 9. Acceptance criteria (observable)

1. `bun run --filter @torii/ui test` and `check` pass; every atom in the §8.4 inventory has a passing
   `*.spec.svelte.js` render test and is exported from `src/index.js`.
2. Switching `data-skin` between `zen-sumi` and `zen-sumi-dark` at runtime re-themes the whole UI with **no
   reload and no FOUC**; the computed `--paper`/`--ink`/`--accent` CSS vars match the §8.1/§8.2 OKLCH values
   exactly (assert via `getComputedStyle`).
3. Both skins pass WCAG AA contrast for body text (`ink` on `paper`, `ink-soft` on `paper-soft`) and for
   the accent-on-paper and on-primary pairings (documented contrast check).
4. A screen built only from `@torii/ui` atoms renders with **zero** `-z{n}` utilities and zero inline
   color literals (lint/grep check passes).
5. `mod+k` opens the `CommandPalette` in both admin and desktop apps; selecting a registered "Go to X"
   command navigates; unregister cleanup leaves no stale commands after unmount.
6. `ExecBadge` renders "local" vs "cloud" **solely** from its `plane` prop — passing `plane:'local'` with a
   cloud-named model still shows "ran on your device" (proves it is not provider-keyed; mockup-review #49).
7. `LockedToggle` with `state:'locked'` renders greyed + lock + tooltip and **does not** emit `onchange` on
   click; with `state:'user-overridable'` it is interactive and emits.
8. `RedactionChip` shows "N items redacted"; `onreveal` fires only when `canReveal` is true.
9. Desktop (`apps/desktop`) and admin (`apps/admin`) both consume `@torii/ui` via `workspace:*`, both
   re-export `@torii/ui/rokkit.config`, and a token/skin change in `packages/ui` reflects in both apps
   after rebuild with no per-app token edits.
10. Desktop production build (Tauri static SPA) renders the correct skin and shell **offline** (no network),
    proving the UI package + skin CSS are self-contained in the bundle.

---

## 10. Open questions

1. **Font delivery for offline desktop.** `zs.css` imports Fraunces/Inter/JetBrains Mono/Shippori Mincho
   from the Google Fonts CDN. A Tauri offline app can't reach the CDN → fonts fall back. Should W4
   **self-host** (bundle) the four font families in `packages/ui` for the desktop build (larger bundle) vs
   CDN-only for web? Leaning self-host for desktop; needs a size/licensing check. *(Genuinely open —
   affects bundle size + licensing.)*
2. **Full `vermillion` palette ramp.** Do we ever need a multi-step accent ramp (e.g. `accent-100…900`)? If
   a future surface needs graded vermillion, define a custom `vermillion` palette (`palettes:` +
   `colorSpace:'oklch'`) instead of the current `orange`-approximation + `overrides`. Deferred until a
   consumer needs it (`rokkit.config.js` already has the TODO).
3. **Admin app shell convergence.** Admin still uses the bare `AppShell` while desktop uses `DesktopShell`
   (phase-1a note). Should the admin portal adopt a shared shell (sans Tauri chrome), or keep a distinct
   web shell? Owner: W1 in coordination with W4 — affects whether the palette + `mod+k` live in one shared
   shell component.
4. **`system` theme persistence semantics.** When a user picks `system`, do we persist the literal `system`
   choice (and re-resolve against `prefers-color-scheme` each boot) or persist the resolved `light`/`dark`?
   (Leaning: persist `system` as an explicit value.) Minor; confirm with W2 Settings.
