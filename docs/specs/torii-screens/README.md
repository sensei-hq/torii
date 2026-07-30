# Torii screens — build-vs-mock audit

> **What this is:** a screen-by-screen functional audit of the **Torii desktop workspace app**
> (`apps/desktop`, SvelteKit + Tauri) against its React mockup, in the style of
> `sensei/docs/spec/dojo-screens/README.md` — every screen traced to a real data source and marked
> MISSING / STUB / PARTIAL / DONE. Companion to the Seiki (admin web) audit
> [`../seiki-screens/README.md`](../seiki-screens/README.md). Audited 2026-07-29.

## Method
- **Mockup** = React IIFE views in `docs/mockups/app/view-*.jsx`, mounted by `docs/mockups/Torii.html`
  (member workspace only — admin views live in `Seiki.html`); fixtures in `docs/mockups/app/data.jsx`.
- **Built** = `apps/desktop/src/routes/(app)/*/+page.svelte` (+ `signin`). Shell =
  `packages/ui/src/lib/DesktopShell.svelte`.
- **Data trace** = `apps/desktop/src/lib/`: `gateway.ts` (Tauri IPC — local inference), `cloud.ts`
  (`/v1/chat`, `/v1/judge` over the gateway), `plane.ts`/`ask.svelte.ts` (split-plane routing),
  `api.ts` (`/v1/requests`, `/v1/budgets`, `/v1/whoami`, `/v1/models/available`); auth via
  `@torii/core` `session`.
- **Rubric:** **MISSING** · **STUB** (chrome only, no wiring) · **PARTIAL** (some real, some
  fixture/absent) · **DONE** (fully wired, matches the mock).

## The one big finding
**Torii's split-plane *inference* core is real and genuinely good — but its two differentiators, RAG
and the workspace model, are essentially unbuilt.** Ask, Playground, and Compare all run real
inference on both planes (local via Tauri `invoke('infer')`, cloud via `POST /v1/chat`); **Compare is
the one DONE screen** and even uses the real C6 judge (`/v1/judge`). Yet:

- **Retrieval is absent everywhere.** Library is a "coming soon" placeholder; Ask is a plain
  chatbot with no sources/citations; Playground is a one-shot prompt runner with none of its
  RAG-pipeline subject matter. The data-intelligence vision (`docs/mockups/CLAUDE.md`) has no app
  surface yet.
- **There is no workspace/space concept in `@torii/core` at all** — Home shows one budget meter and
  a request log instead of the mock's lane/workspace orientation; the tenant **WorkspaceSwitcher** is
  a plain nav palette (single-tenant-per-user per project memory).
- **Personal surfaces are thin** — Activity is a request log without the member budget cascade or
  "why this model" trace; Settings is an account panel, not a preferences screen; Signin uses
  client-only password auth, not the mock's OAuth/magic-link.

So unlike Seiki (real-data-but-shallow admin screens), Torii is **earlier**: the plumbing exists in
`lib/` but only Ask/Playground/Compare/Home/Activity consume it. Workflows is an *intentional* v2
placeholder (agents are design-only for v1), not a gap.

## Status (10 screens)

| Screen | Zone | Status | Core gap |
|---|---|---|---|
| Workspace (home) | Workspace | PARTIAL | budget ceiling + recent wired; no workspace/lane model, workspaces grid, start-new, ingestion |
| Ask | Workspace | PARTIAL | real split-plane chat + exec badges; **zero retrieval / sources / "why this model"** — a plain chatbot |
| Library | Workspace | **STUB** | "coming soon" card; document center + DocWorkspace (ingestion/chunks/lineage) entirely unbuilt |
| Playground | Tools | PARTIAL | real one-shot inference; the entire RAG pipeline/inspector/meters/templates/tools is absent |
| Compare | Tools | **DONE** | real multi-model inference + real C6 judge ranking; only cosmetic mock bits missing |
| Local models | Tools | PARTIAL | read-only installed list real; no download/remove/set-default/HW/storage/fit (no backend commands) |
| Workflows | Tools | STUB *(by design)* | intentional v2 preview — agents/DAG design-only for v1 |
| Activity | You | PARTIAL | real request table + stats; no budget ceiling/cascade, "why this model" trace, increase flow, filters |
| Settings | You | PARTIAL | real account + working sign-out; the whole preferences surface (theme/answering/notifications) unbuilt |
| Signin | Entry | PARTIAL | real password auth; no OAuth/magic-link/SAML, demo persona picker, or Seiki cross-link |

**Tally:** 1 DONE · 7 PARTIAL · 2 STUB (one by design).

## Shell / nav
`DesktopShell.svelte` faithfully reproduces the mock's three rail groups (`app.jsx`): **Workspace**
(Home/Ask/Library), **Tools** (Playground/Compare/Workflows/Local models), **You**
(Activity/Settings), with a real tenant name via `/v1/whoami`. Not built vs `shell.jsx`: the tenant
**WorkspaceSwitcher** (⌘K palette that switches tenants by org→dept→team→personal tier — the built
⌘K only navigates fixed nav items), the title-bar **EnvChip** (desktop/offline/web state), the
search + notifications buttons, and the dev **PersonaSwitch**.

## Per-screen detail

### Workspace (home) — PARTIAL
Real: greeting name (`session.user`), budget ceiling meter (`api.budgets()` → org node), "Recent" list (`api.requests(6)`). Missing: the **LaneCard** (workspace name/classification/tier/people, "models you can use"), the **workspaces grid** by tier, "**Start something new**" quick-actions + template handoff, "**Needs attention**" ingestion list, offline banner, workspace switcher. Root cause: **no workspace concept in `@torii/core`** — `useWorkspace`/classification/tier don't exist.

### Ask — PARTIAL
Real: split-plane chat — `ask.send()` → `route()` → local Tauri `invoke('infer')` or cloud `POST /v1/chat` (JWT), with `ExecBadge` + real model/region/cost from `InferResult`. Missing (the mock's whole point): **retrieval** — sources rail, inline citations, chunk deep-links to Library; the **"why this model" RoutingPanel** (auto vs pinned vs offline reason); pinned-model; grounding/quality/latency meters; task tabs; draft-to-library; scope card. `/v1/chat` is called with no document grounding. *(Model label falls back to a hardcoded `gemma2:2b`.)*

### Library — STUB
26-line placeholder: `PageHeader` + one "Document workspace — coming soon" `Card`, imports no data layer. The mock is a full **document center** (workspace-scoped index, collections, tag filter, storage meter, bulk reclassify/move/tag/reprocess, upload→normalize dropzone) **+ `DocWorkspace`** (ingestion pipeline stepper, parse-quality/redaction, Preview markdown/CSV-datagrid/figures, Chunks with rerank scores, Comments, Redactions, Lineage, Versions). None wired.

### Playground — PARTIAL
Real: one-shot prompt runner — system+user textareas, local/cloud toggle, Run → `cloudInfer`/`gateway.infer`, Result (content/model/ExecBadge/cost/duration); "Inspect" = `JSON.stringify` of req/resp. Missing (the mock's actual subject): the **RAG pipeline rail** (4 retrieval levels, dense/sparse/hybrid + weight, chunking sliders, 6 advanced modes, feature toggles, tools allow-list), the **inspector** (retrieved chunks with scores/bbox or SQL text), **sources + judge verdict**, and 6 live meters (grounding/quality/cost/latency/recall/precision).

### Compare — DONE
Real, arguably richer than the mock: 2–4 columns each run for real in parallel (`gateway.infer` local + `cloudInfer` cloud/named), model list merged from `gateway.listModels()` + `api.availableModels()`, quality/ranking from the **real C6 judge** (`/v1/judge` → `judgeAnswers`), winner highlight. No fixtures. Only cosmetic mock bits absent: fixed demo prompt (built requires input), a separate grounding meter, "Open winner in Playground" handoff.

### Local models — PARTIAL
Real: read-only installed list via `gateway.listModels()` → Tauri `list_models` (all `local:true`). The "default" pill is a hardcoded `gemma2:2b`. Missing: **device HW card**, **storage** meter, **download** (available registry + memory-fit estimate + progress), **set-default / update / remove**, admin-blocked rows. Confirmed the **backend commands don't exist** — the Tauri handler exposes only `infer`/`list_models`/`gateway_status`.

### Workflows — STUB (by design)
A `PageHeader` + one static "v2 preview — designed in v1, ship in v2, no runtime yet" card. The mock is a full Tools/Workflows product (index + List/**DAG-canvas** builder + Runs trace + Governance + agent builder). Intentionally deferred per the agents-design-only decision — flagged here for completeness, not as a defect.

### Activity — PARTIAL
Real: `api.requests(100)` → 3 stat cards (Requests/On-device/Spend) + a "Recent requests" table with loading/error/empty. Missing (what makes it the *member* Activity view): the personal **budget ceiling + cascade** (a matching `/v1/budgets` endpoint exists but isn't called), the **request-increase flow**, the **"why this model" trace**, and filters/search/space/date + Outcome/Device/Requested→Served columns + CSV export.

### Settings — PARTIAL
Real (identity only): Account card (avatar/name/email·role) + working **Sign out** (`session.signOut()`). "Appearance" is just a text note, not a control. Missing: the mock's entire **"Your preferences"** surface (real theme toggle, language/region, answering defaults — model/tier/citation-density/retention/auto-tune, notifications, on-device link) and the admin-**locked** rows. Nothing persisted.

### Signin — PARTIAL
Real: email+password → `session.signInWithPassword` (client-only Supabase session), error display, `goto('/')`. Layout faithfully ports the mock (brand, routing SVG, 3 value props). Missing vs mock: **OAuth (Google/GitHub)**, **magic-link**, **SAML SSO** row, demo persona picker, and the "Administrator? Open Seiki" cross-link. (Divergence is intentional per the client-only-session design — but note Seiki's signin *does* have OAuth + magic-link.)

## Cross-cutting workstreams (the real shape of the work)

- **WS-1 · Retrieval / RAG — the core vision.** Build the Library document center + `DocWorkspace`;
  add retrieval to Ask (sources/citations/chunk deep-links) and Playground (pipeline/inspector/
  meters). Needs RAG read endpoints + ingestion. This is Torii's biggest missing pillar and it
  depends on **Seiki's Spaces & KB** (space-level KB config).
- **WS-2 · Workspace / space model.** There is no workspace concept in `@torii/core`; build spaces +
  lane orientation on Home + the ⌘K workspace switcher. Shared backing with Seiki Spaces.
- **WS-3 · Personal budget + trace surfaces.** Activity budget ceiling + cascade + request-increase
  (`/v1/budgets` already exists), and the **"why this model" routing trace** (shared with Seiki
  Requests — both blocked on a per-call trace in the schema).
- **WS-4 · Local model management.** New Tauri commands for download/remove/set-default + device
  HW/storage/fit UI. Backend-first.
- **WS-5 · Personal shell + auth polish.** Settings preferences surface; Signin auth-method decision
  (adopt OAuth/magic-link like Seiki, or keep client-only password?); shell chrome (EnvChip,
  search/notifications).
- *(Workflows = deferred to v2 by decision — not a workstream.)*

## Suggested priority (dependency-aware)
1. **WS-3** budget cascade + the shared **per-call trace** schema — cheap, high personal value, and
   the trace also unblocks Seiki Requests.
2. **WS-2** the workspace/space model — it's the substrate Home, Library, and Spaces all need.
3. **WS-1** RAG — the flagship, built on WS-2 + Seiki's Spaces & KB. Largest effort.
4. **WS-4** local-model management (independent; can slot in anytime a desktop push is wanted).
5. **WS-5** Settings + Signin + shell polish.

## Open questions — RESOLVED 2026-07-29
Cross-checked against `DECISIONS.md` + `plans/roadmap.md`:
- **RAG in v1?** **YES** — ratified (DECISIONS §3a; C5/P7 + W2/P9). Library/Ask/Playground retrieval
  are pending *phases*, not open scope. This is the confirmed **next focus (P7)**.
- **Workspace/space model?** **YES, v1** — spaces + classification ACL (DECISIONS §3/§3a; P7–P9).
- **Torii auth:** reconcile the client-only-password deviation to **magic-link + GitHub OAuth** via
  `torii://` (DECISIONS §9/§10.2), password secondary — scheduled into auth-polish (WS-5).
- **Local-model management:** **v1** — D2-full, roadmap P10 (download/remove/set-default + device HW/fit).

See **DECISIONS §10** for the authoritative rulings.

## Related
- Seiki (admin web) companion audit: [`../seiki-screens/README.md`](../seiki-screens/README.md)
- Visual/grid pass: [`../../design/fidelity-audit.md`](../../design/fidelity-audit.md)
- Product intent + screen map: [`../../mockups/CLAUDE.md`](../../mockups/CLAUDE.md)
