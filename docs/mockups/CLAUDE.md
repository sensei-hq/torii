# Strategos — project notes

Strategos is a local-first **AI gateway** for an org: one address for every model across many
routers, with a split execution plane (on-device vs via the gateway). Two first-party clients:

- **Strategos Console** (`Strategos Console.html`) — member workspace: Workspace, Ask, Library,
  Playground, Activity/Requests, personal Settings.
- **Strategos Admin** (`Strategos Admin.html`) — admin portal: Overview, Requests & audit,
  Organization, Onboarding, Models, Routing, Connections, Governance, Budgets & billing, Settings.

Built with the **Zen-Sumi design system** (washi paper / sumi ink / one vermillion accent).
React + Babel, split across `app/*.jsx` IIFE modules. Shared atoms in `app/atoms.jsx`
(`window.StrategosUI`), catalog/data in `app/data.jsx` (`window.StrategosData`),
icons in `app/icons.jsx`, env state in `window.StrategosEnv`.

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
