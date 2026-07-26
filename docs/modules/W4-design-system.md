# W4 · Design system & shared UI

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Web · **Status:** Planned · **Depends on:** none (enables W1, W2, W3; W5 lightly) · **Tech:** Rokkit

## Purpose

One shared component library and visual language used by every UI (web apps + the desktop app), so screens feel consistent rather than per-page.

## What we build

- **Rokkit components** (List, Tree, Select, MultiSelect, Table, Tabs, Toggle, Menu, CommandPalette) consumed data-first (`items`, bindable `value`, `fields`, `onchange`/`onselect`).
- **Semantic styles** via UnoCSS `presetRokkit` — named tokens (paper / ink / primary / on-primary / *-soft), **ported from `app/zs.css`'s named vocabulary** (the authoritative token source per DECISIONS §6), then extended with Torii brand tokens (`rokkit.config.js` palette → skin → tokens).
- **Skins**: light/dark dual palettes; a Torii brand skin; `SkinSwitcherToggle`.
- **Command palette** (`mod+k`) via `@rokkit/states` + `@rokkit/actions`.
- Shared atoms rebuilt as Rokkit-native components in a **dedicated atom-migration** pass. The mockups' `_ds/` system is **reference-only** (§6) — mine its vocabulary/behaviour, do not port it wholesale.
- Packaged as `packages/ui`, consumed by web (Cloudflare Pages) and the Tauri app.

> At implementation time, consult the **rokkit skills** (`rokkit-components`, `semantic-styles-rokkit`, `skin-system-rokkit`, `command-system-rokkit`).

## UI surfaces

Indirect — provides components to all apps.

## Reuse / source

`docs/mockups/` — canonical UI = `app/*.jsx` + `app/zs.css` (token vocab); `_ds/` + `atoms.jsx` are **reference-only** (§6). **Not** `components/*.jsx` — that is the W5 marketing app (separate). Rokkit ecosystem + skills.

## Open questions

- **Resolved (§6):** the token vocabulary ports from `app/zs.css`'s named tokens. **Still open:** the exact `zs.css` → Rokkit named-token map + the dark-skin palette; how Tauri consumes `packages/ui` (bundled vs workspace).
