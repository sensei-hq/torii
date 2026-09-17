# Seiki/Torii ↔ gateway alignment — screen map, crate delta, schema gaps

> **Status:** analysis, 2026-09-17 (revised after the design import landed). Verified against
> `~/Developer/torii` @ `dd41ddb` + the imported `docs/mockups/`, and `~/Developer/gateway`
> @ `1ac4e4e`. Claims are source-checked; assumptions are flagged.

---

## 1. What the import brought

**Four new views, not two** — my pre-import estimate was based on the shared file list,
which omitted the two Torii-side files. The agentic surface spans **both apps**:

| new view | app | role |
|---|---|---|
| `view-registry.jsx` | Seiki | `AgentsView` + `SkillsView` + `PublishView` (34 KB) |
| `view-runs.jsx` | Seiki | run ledger + intervention queue + kill switch |
| `view-agentic.jsx` | Torii | goal → planner → DAG → orchestrator walk |
| `view-approvals.jsx` | Torii | member inbox: gates, second-approvals, budget requests |

Plus 45 modified files (notably `content.js` 57 KB → 79 KB, `view-organization` +8 KB,
`view-governance` +3 KB), 3 journey maps, 14 design scraps, and the deletion of
`Strategos Journey Map.html`.

**This answers gateway spec §8.1 and §8.2.** Torii is a UI, not a CLI; and seiki/torii are
**two apps split by audience** — admin registry + run oversight in Seiki, end-user execution
+ personal approvals in Torii.

### 1.1 Coverage against the gateway's 12-screen spec

| spec screen | designed as | state |
|---|---|---|
| 5.1 Registry overview | `PublishView` (collections, generation, dirty, paused count) | ✅ |
| 5.2 Agent editor | `AgentsView` (list + full-page editor) | ✅ |
| 5.3 Skill editor | `SkillsView` | ✅ |
| 5.4 Tool editor (ToolSpec) | — | ❌ **not designed** |
| 5.5 Chain bindings | — (delegated to Routing; `NODE_CHAINS` fixture only) | ❌ **not designed** |
| 5.6 Push review (consent) | `PublishView` | ✅ |
| 6.1 Submit a goal | `view-agentic` | ✅ |
| 6.2 Run detail / journal | `view-agentic` JOURNAL + `view-runs` CALLS | ✅ |
| 6.3 Plan review | `view-agentic` PLAN DAG | ✅ |
| 6.4 Intervention queue | `view-approvals` (member) + `view-runs` (admin) | ✅ |
| 6.5 Budget and spend | `view-runs` (cost/cap tracks) | ✅ |

**10 of 12 designed.** The two gaps are the ToolSpec editor and Chain bindings — and both
are deliberate: `view-tools.jsx` now reads the shared registry tool model
(`RT = content.registry`) and says *"Who may call what lives on the org tree"*, while
`content.js` notes *"Routing owns these; the agent editor only shows the resolved result."*

---

## 2. Three places the design contradicts the engine

This is the most important section. The mockups are internally coherent and, in my view,
better product design than the engine's current model — but they cannot be built on gateway
as it stands. Each needs an explicit ruling.

### 2.1 Per-entity publish vs. replace-all

The design stages and publishes **one entity at a time**:

```js
STAGED: [ { kind:'agent', name:'arrears-chaser', change:'changed', from:5, to:6, inFlight:1 }, … ]
PUBLISH_LOG: [ { what:'arrears-chaser v5 · service-charge-auditor v2', mode:'per agent' },
               { what:'generation 40 · full set', mode:'replace all · drained first' } ]
```

Note `inFlight: 1` — the design shows *per-entity* in-flight run counts, implying you can
publish one agent while others keep running.

The engine does the opposite. Gateway spec §4: **"Push is replace-all"** and **"Any
successful push terminally kills every already-paused run"** — one global generation, one
fence, all-or-nothing.

**This is the headline mismatch.** The design is right about what operators need; the engine
cannot serve it today. Options: (a) per-entity generations + per-entity fences in the engine,
(b) keep replace-all and redesign `PublishView` around drain-then-swap, or (c) torii owns
config entirely and computes a replace-all push from per-entity staging. **(c) is the
cheapest path consistent with your "torii owns persistence and configuration" directive** —
staging and versioning live in torii, and the engine still receives a whole set.

### 2.2 Chain bindings keyed on the org tree, not `area`

The design binds chains to **org units**, with inheritance:

```js
NODE_PATH:   { Leasing: ['Northwind Estates','Operations'], … }
NODE_CHAINS: [ { node:'Leasing', kind:'analyst', chain:'analysis.deep' }, … ]
chainFor(agent)  // walks the path leaf→root, first match wins
```

The engine binds `(area, kind) → chain`, and spec §3 says **`area: planning` is
load-bearing — "the only role string the engine itself reads"**, because planner candidates
are collected by `area == 'planning'`.

The design has **no `area` field at all**. It has `kind ∈ {analyst, operator, reviewer,
router, writer}` and a per-agent `planner: true|false` (on `tenant-reply-drafter`), which
maps to the engine's `default_planner: bool` — but `default_planner` only *designates among
candidates*; it does not *make* an agent a candidate. **As designed, the engine would find
zero planner candidates.**

This needs resolving before `AgentsView` is built: either torii derives `area` at push time
(e.g. `planner:true ⇒ area:'planning'`), or the engine stops keying candidacy on `area`.
Binding on the org tree is otherwise a genuine improvement and fits torii's `core.org_units`.

### 2.3 Per-entity versions vs. one global generation

Design: every agent and skill carries its own `version` (`v3`, `v5`), and staged rows show
`from: 5 → to: 6`. `view-runs` even records which versions a run used
(`"arrears-chaser v5"`), which is exactly right for audit.

Engine: `orchestrator.config_versions` is a **singleton** — one `version` bigint for the
whole database. There is no per-entity version anywhere.

Per-entity versioning is a torii-side concern and fits naturally in torii's schema.

---

## 3. Fields the design needs that no schema has

The design introduces torii-native concepts absent from the gateway `AgentDefinition`:

| field | on | meaning |
|---|---|---|
| `node` | agent | owning **org unit** (`core.org_units`) — drives chain inheritance *and* budget |
| `approver` | agent | who answers its gates ("Team lead", "Finance lead", "Owner") |
| `perRun` | agent | **cost cap per run** ($0.60) — distinct from token budget |
| `grants.{calls, confirm}` | agent→tool | per-tool call ceiling + confirm-before-execute |
| `backing` + `timeout` + `escalate` | agent | `Model` vs `Human`, with escalation target |
| `server`, `exec` | tool | owning MCP server + `gateway` \| `on-device` execution plane |
| `version`, `state` | agent/skill | per-entity version + `clean\|added\|changed` staging state |
| `origin` | run | `plan` \| `workflow` |
| `changes` | run | count of Mutation-class effects (the "what changed the world" column) |
| `kind`, `escalate`, `timeout`, `facts[]`, `options[]` | approval | inbox item shape |

`perRun` and `node` are the important ones: they tie agentic spend into the **existing**
budget tree rather than a parallel token budget. `view-runs` states this explicitly —
*"A run debits the same budget node as a question. Spend here and in Budgets & billing is
the same number."* That is a strong architectural constraint and a good one: it means
agentic runs must go through torii's existing reserve→commit path, not the engine's separate
token budget.

---

## 4. The gateway crate — the upgrade is done, the release is not

`cargo check --workspace` against gateway HEAD → **exit 0**. The type-level changes don't
touch torii:

| change | breaks torii? |
|---|---|
| `GatewayStore` trait | **no** — byte-identical v0.5.1 → HEAD |
| `GatewayError::AllGated` (new) | **no** — no exhaustive matches in torii |
| `StreamEvent::Error.resume_after` (new) | **no** — zero `StreamEvent` references |
| `RouterConfig.catalog: Option<CatalogMeta>` | **no** — additive |
| `sensei-vault` | **no** — doc comment only |

**But dev and prod build different engines.** `Cargo.toml`'s `[patch]` redirects to
`../gateway` (verified: `sensei-gateway v0.5.1 (/Users/Jerry/Developer/gateway/…)`), while
`services/gateway/Cargo.toml` pins `tag = "v0.5.1"` — **828 commits apart, no release tag
past v0.5.1**. This is a live divergence: anything dev-tested locally may not exist in
production.

Worth repinning for: catalog tiers/free-tier metadata (`CatalogMeta`, `FreeTier`,
`trains_on_prompts`, cost bands — the model economics the Models screen wants), the `gates/`
module (budget, capability, circuit-breaker, context-window, cooldown, lockout), an 811-line
selection rewrite, and `AllGated` + `resume_after` for durable pause/resume.

---

## 5. Ownership — and the schema that must not be adopted as-is

### 5.1 Gateway is now a second, single-tenant database project

`~/Developer/gateway/database/design.yaml` declares project `sensei-orchestrator`, schema
`orchestrator`, 11 tables. Verified facts:

- **No table has a `tenant_id`** (zero matches for `tenant` across all 11 DDL files).
- **No RLS.**
- `config_versions` is a hard singleton: `id boolean primary key default true check (id)`.

Combined with "any push kills every paused run", adopting this into Seiki means **tenant A's
publish terminally kills tenant B's in-flight runs**, and all tenants share one registry.
That is a cross-tenant breach by construction.

Gateway also ships `crates/torii`, a CLI "operator control plane" with `config push` — the
same role Seiki now plays, against its own Postgres.

### 5.2 The boundary — RATIFIED 2026-09-17 (DECISIONS §11)

> Gateway is always a **library**; torii is the web interface and the persistence. Moving
> persistence into gateway would break its use as a library. Gateway's SP-DATA Phase-4
> extraction of torii's `catalog`/`config`/`metering` schemas is **cancelled**.
>
> Evidence this is gateway's own pattern: `crates/gateway` carries **no DB dependency**, and
> `vault` / `orchestrator-store` gate Postgres behind off-by-default features.

| concern | owner |
|---|---|
| Routing, adapters, capability traits, selection, gates | **gateway** (library) |
| Orchestrator execution kernel, journal semantics, replay | **gateway** (library) |
| Vault crypto primitives | **gateway** (library) |
| *Trait definitions* for persistence (`GatewayStore`, `ConfigSource`) | **gateway** (library) |
| **All Postgres schema + migrations + tenancy + RLS** | **torii** (dbd) |
| **Registry content, staging, versioning, publish** | **torii/seiki** |
| **Admin + operator UI** | **seiki** / **torii** |

Gateway should ship `orchestrator-store` as **traits + an in-memory impl**; torii implements
them over its own tenant-scoped, RLS-shielded schema — exactly the relationship that already
works for `GatewayStore` (`services/gateway/src/store.rs`). That is the precedent to extend.

---

## 6. Schema work the new screens require

All tenant-scoped, RLS-shielded, in torii's dbd project. None of this exists today.

| table | backs |
|---|---|
| `registry.agents` | `AgentsView` — incl. `node`→`core.org_units`, `approver`, `per_run_cap`, `backing`, `timeout`, `escalate`, `version`, `state` |
| `registry.agent_tools` (+ `calls`, `confirm`) | grants |
| `registry.agent_skills` | agent→skill |
| `registry.skills` | `SkillsView` — `activation`, `keywords[]`, `tokens`, `version` |
| `registry.tools` | ToolSpec — `effect_class`, `creds[]`, `server`→`mcp_servers`, `exec`, `exists` |
| `registry.node_chains` | `(org_unit, kind) → chain` with tree inheritance |
| `registry.staged_changes` | `STAGED` — per-entity diff + `in_flight` |
| `registry.publish_log` | `PUBLISH_LOG` — who/when/what/mode |
| `runs.runs` | `view-runs` — `origin`, `node`, `status`, `cost`/`cap`, `calls`, `local`, `gates`, `changes`, `versions` |
| `runs.journal` | per-node events + `effect_class` + tokens + `local` |
| `runs.approvals` | `view-approvals` — `kind`, `question`, `facts`, `options`, `timeout`, `escalate` |

**Reuse, don't duplicate:** `catalog.chains` already exists for `GATEWAY_CHAINS`
cross-validation, `core.org_units` for `node`, `governance.nodes` for budget, and
`mcp_servers` for tool servers.

### 6.1 Orphaned tables — schema with no reader

Verified with ripgrep over `services/gateway/src`, `apps/*/src`, `crates` (excluding DDL and
docs): **zero code references.**

- `catalog.routing_policies` — Routing policy card
- `catalog.provider_health` — Routing provider-health card
- `catalog.provider_overrides` — Connections per-router overrides
- `catalog.chain_bindings` — **this is the `(area,kind)→chain` table**; the design wants
  `(node,kind)` with inheritance. Reshape rather than add a new table.

### 6.2 Backend-ready, frontend-unwired

Served but no screen calls them: `/v1/analytics/{cost-trend,plane-split,model-mix,quality,spend,metrics,export}`
(**7 of 8**), all six `/v1/documents*` routes, `/v1/retrieval/set-config`,
`/rpc/mcp/{register-server,refresh-tools}`, `/v1/models/available`,
`/v1/governance/matrix`, `/rpc/governance/clear-feature`, `/rpc/devices/set-sync-policy`,
`/v1/config/snapshot`.

Overview's missing cards and Spaces & KB are **frontend** tasks — the backend is waiting.

---

## 7. Screen map — current state

**Seiki** (21 mockup views vs 14 built routes): 13 built · 3 folded in (API keys → Organization,
Alerts → Settings, Features → Governance) · 2 missing (Spaces & KB, Templates) · **2 new
(Registry, Runs)** · 2 undesigned (Tool editor, Chain bindings).

**Torii** (13 mockup views vs 11 built routes): 11 built · **2 new (Agentic, Approvals)**.

⚠️ **`view-tools.jsx` changed model.** It now reads the shared registry tool list and moves
per-role allow-lists onto the org tree. The built Tools screen's tools×roles matrix
(`tool_allow_lists`) is superseded by that design — reconcile before building further there.

The prior audit `docs/specs/seiki-screens/README.md` (2026-07-29) is ~7 weeks stale: MCP
enforcement (now wired, `chat.rs:831-859`), routing trace (`/v1/requests/{id}/trace`), and
budget-tree editing have all since closed.

---

## 8. Sequence

**Phase A — finish the screens (no new backend).** Wire the 7 unwired analytics endpoints
into Overview/Billing; promote API keys / Alerts / Features to real routes.

**Phase B — configuration surfaces.** Build Spaces & KB on the existing `/v1/documents*` +
`/retrieval/set-config`; add `templates`; wire the 4 orphaned catalog tables to endpoints and
the Routing screen (reshaping `chain_bindings` per §2.2).

**Phase C — agentic. Decisions before code.**
1. Rule on §2.1 (per-entity publish), §2.2 (`area` vs org-node binding), §2.3 (versioning).
2. Design the `registry.*` / `runs.*` schema tenant-first (§6).
3. Cut a gateway release and repin production off `v0.5.1` (§4).
4. Then build Registry → Runs → Agentic → Approvals.

**Do not build Registry/Runs against the current orchestrator schema.** It is single-tenant
and would bake a cross-tenant defect into the newest surface.

---

## 9. Decisions needed from you

1. **Per-entity publish or replace-all?** (§2.1) — recommend torii stages per-entity and
   pushes a whole set to the engine.
2. **`area` vs org-node chain binding?** (§2.2) — recommend torii derives `area` at push so
   the engine keeps finding planner candidates.
3. ~~Where do registry/run tables live?~~ **RESOLVED 2026-09-17 — torii's dbd project, tenant-
   scoped and RLS-shielded (DECISIONS §11).**
4. ~~Does gateway's `crates/torii` CLI continue?~~ **RESOLVED 2026-09-17 — it is a dev/ops tool,
   not the product's config surface; any `config push` targets torii's schema (DECISIONS §11).**
5. **Tool grants: org tree or tools×roles matrix?** (§7) — the design moved them; the built
   screen and `tool_allow_lists` have not.
6. **Model economics source** — gateway's `CatalogMeta` or a torii table?

---

## Related

- `crates/torii/docs/features/agentic-execution-surface.md` (gateway) — the 12-screen spec
- `docs/mockups/CLAUDE.md` — "Registry + agentic flows (Sept 2026)"
- `docs/specs/seiki-screens/README.md` — prior audit, needs refresh
- `docs/design/fidelity-audit.md` — visual/grid pass
