# W4 · Design system & shared UI

**Plane:** Web · **Status:** Planned · **Depends on:** none (enables W1, W2, W3, W5) · **Tech:** Rokkit

## Purpose
One shared component library and visual language used by every UI (web apps + the desktop app), so screens feel consistent rather than per-page.

## What we build
- **Rokkit components** (List, Tree, Select, MultiSelect, Table, Tabs, Toggle, Menu, CommandPalette) consumed data-first (`items`, bindable `value`, `fields`, `onchange`/`onselect`).
- **Semantic styles** via UnoCSS `presetRokkit` — named tokens (paper / ink / primary / on-primary / *-soft), extended with Strategos brand tokens (`rokkit.config.js` palette → skin → tokens).
- **Skins**: light/dark dual palettes; a Strategos brand skin; `SkinSwitcherToggle`.
- **Command palette** (`mod+k`) via `@rokkit/states` + `@rokkit/actions`.
- Shared atoms migrated from the mockups' `_ds` system.
- Packaged as `packages/ui`, consumed by web (Cloudflare Pages) and the Tauri app.

> At implementation time, consult the **rokkit skills** (`rokkit-components`, `semantic-styles-rokkit`, `skin-system-rokkit`, `command-system-rokkit`).

## UI surfaces
Indirect — provides components to all apps.

## Reuse / source
`docs/mockups/` `_ds`, `components/`, `atoms.jsx`; Rokkit ecosystem + skills.

## Open questions
- Token/skin vocabulary finalization; how Tauri consumes the package (bundled vs workspace).
