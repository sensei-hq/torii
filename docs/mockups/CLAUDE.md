# Strategos — project notes

Strategos is a local-first **AI gateway** for an org: one address for every model across many
routers, with a split execution plane (on-device vs via the gateway). Two first-party clients:

- **Torii** (`Torii.html`) — member workspace (desktop client): Workspace, Ask, Library,
  Playground, Activity/Requests, personal Settings.
- **Seiki** (`Seiki.html`) — admin portal (web): Overview, Requests & audit,
  Organization, Onboarding, Models, Routing, Connections, Governance, Budgets & billing, Settings.

Built with the **Zen-Sumi design system** (washi paper / sumi ink / one vermillion accent).

**Styling is pure UnoCSS.** `app/uno.config.js` is the whole system — theme (semantic
colors, eight-size type scale, radii, shadows, motion), `shortcuts` for the component
vocabulary (`card`, `nav`, `tbl`, `cmdk-*`, `wf-*`…) **and every responsive
composition** (`view-pad`, `grid-split`, `grid-half`, `grid-stats`, `grid-flush-2/3`,
`grid-hero`, `pg-split`, `tbl-stack`), plus `preflights` for element resets only (all
wrapped in `:where()` so utilities always win — no `!important`). The config sets
`window.__unocss` *and* `module.exports`, so the app repo consumes it unchanged.

⚠ **Arbitrary variants (`[&_td]:`, `[&>*+*]:`) only compile from the config.** The
runtime extractor ignores them in markup — any class string containing one must be a
shortcut, or it is silently inert.

⚠ **Spacing is UnoCSS's default 4px scale** — `p-4`, `gap-6`, `mt-12`, `px-2.5`. The
Zen-Sumi steps land on it exactly (4·8·12·16 = 1·2·3·4; 24·32·48·64·96 = 6·8·12·16·24), so
there is no custom scale and no `--space-*` tokens. Sub-4px steps use the fractional
stops (`0.5` = 2px, `1.5` = 6px, `2.5` = 10px); never bracket a spacing value.

`app/zs.css` holds only the CSS-variable tokens. Responsive behaviour is `lt-sm:` /
`sm:` / `lg:` / `xl:` variants; there are no media queries and no hand-written CSS rules.
Loaded via the `@unocss/runtime` CDN.

House rules for this work live in `docs/DESIGN_PRINCIPLES.md` (read before building) and
`docs/MIGRATION.md` (conversion recipe + the reset/specificity/runtime traps). Verify by
computed style, never by screenshot.

React + Babel, split across `app/*.jsx` IIFE modules. Shared atoms + the component kit in
`app/atoms.jsx` (`window.StrategosUI` — `Button`, `Table`, `Card`/`CardHead`, `PageHeader`,
`Section`, `Stat`, `Tabs`, `Pill`, `Tag`, `Chip`, `StatusDot`, `Meter`, `Track`, `Switch`,
`Kbd`, `EmptyState`, `ExecBadge`…). **Never hand-roll a button or table** — use the kit so
the class vocabulary stays in one place.

**Data goes through one seam.** `app/api.jsx` (`window.StrategosAPI`) is the only module
views read data from; `app/data.jsx` is the shared fixture catalog and `app/content.js`
holds per-view copy + fixtures (134 entries, one namespace per view) reached as
`API.content.<view>`. Each resource has an endpoint (`API.endpoints`), a sync fixture
read, and `await API.<resource>.load()`. Flip `StrategosAPI.config.mode = 'http'` +
`baseUrl`/`token` to hit real endpoints; move a content namespace into a resource when it
goes live. Use `API.useResource(() => API.x.load(), [])` for anything that will be live —
`app/view-models.jsx` is the reference implementation.

Markup carries no static inline styles — tokens live in utilities. Inline `style={{…}}`
is reserved for genuinely dynamic values (computed widths, tone colors from data), and
headline/body prose stays in JSX on purpose so it stays editable in the preview.

Typography is Fontsource, one stylesheet per weight/subset (`app/fonts.css`); the manifest
there is mirrored by `fonts` and `theme.fontWeight` in the config — no other weight loads.
Icons in `app/icons.jsx`, env state in `window.StrategosEnv`.

## Product decisions (set by the user, June 2026 — Jerry's roadmap)

1. **MCP & tools** — IN SCOPE for v1. Register MCP servers (stdio for desktop, http/sse for
   shared) + tool allow-lists per role/space.
2. **Programmatic API access** — YES. The gateway is a programmable endpoint for the org's own
   apps; issue scoped tenant API keys + usage. Service accounts / API identities in Organization.
3. **Agents & plans** (ReAct agents + DAG plans) — v2 feature, but DESIGN the screens now.
4. **Roles** — NOT a fixed four. Build a **generic hierarchical role/org structure** that maps to
   any org's internal hierarchy (e.g. org → department → team → user), and that **budget
   allocation cascades down**. Roles/permissions and budget caps both follow this generic tree.

## Cross-cutting layers already built
- **Execution-location badges** (`ExecBadge`) — "ran on your device" vs "via gateway · eu-west-2".
  Live on Ask, Playground, Activity, Models, Routing.
- **Device / sync / offline / desktop-vs-web** — `window.StrategosEnv` (desktop / offline / web,
  cycle via the title-bar `EnvChip`). Drives rail footer sync state, `DevicePill`,
  `OfflineBanner`, `DesktopOnlyNote`, and the Models device-capability chip.

## Roadmap still open (sequence)
Phase 2 (in progress): Library → document workspace; Playground retrieval modes + inspector;
make read-only admin editors editable. Phase 3: new screens (Local models, Device fleet, Feature
management, Spaces & KB, Compare, Templates, Alerts, API keys). Phase 4: the policy model
(workspace-default → space-override → user-preference) + feature governance (locked/overridable).
