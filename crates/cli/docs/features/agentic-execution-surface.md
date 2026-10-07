# The agentic execution surface — seiki (administer) and torii (operate)

**Status:** requirements. Nothing here is built as UI; `torii` is a CLI today and the only
mockups in this repo are the marketing landing page (`docs/mockups/`), which covers none of it.
Every screen below is greenfield.

**Naming used here:** **seiki** is the administrative surface — where agents, skills, tools and
chain bindings are registered. **torii** is the operating surface — submit a goal, watch a run,
unblock it when it needs a human. They may be one app with two areas or two apps; that decision
is open (§8).

Facts about the engine in this document were verified against the source in September 2026. Where
something is an assumption rather than a verified fact, it says so.

---

## 1. Why this exists

The execution engine is deep — durable replay, effect classes, hierarchical graphs, planning,
sandboxing, human-in-the-loop, Postgres persistence, per-candidate context-window routing. What it
has never had is a way for a person who did not write it to *use* it.

The evidence is specific and recent:

- `PlannerRef::Select` was dead in every shipped binary until PR #63 — an entire planning slice
  could not run, and the test suite was green throughout.
- The five planner discovery tools were built, tested, and wired nowhere until gateway v0.11.0
  (torii#53 adopts it): `Executor::pinned` now composes them per run.
- **No registry content ships at all.** Zero agents, skills, tools. The activation mechanism has
  no production constructor because nothing constructs it.
- Until PR #64 there were zero `.md` files under `crates/torii`.

The pattern is features built and then not connected to anything reachable. This document
specifies the surface that connects them.

---

## 2. The end-to-end journey

This is the flow the two surfaces exist to serve. Mechanisms named here are real and shipped
unless flagged.

**Administer (seiki), once.** An operator registers the building blocks: **agents** (a role, a
system prompt, the skills and tools it may use, and a chain that routes it to models),
**skills** (prompt fragments, optionally activated only on keywords), **tools** (a model-facing
schema plus an effect class), and **chain bindings** mapping a role to a model chain. These are
authored as a set and pushed atomically; the push advances a durable config generation.

**Set a goal (torii).** A user submits a graph containing an `Expand` node whose planner is
`PlannerRef::Select` — "choose a planner for this goal" rather than naming one.

**Plan.** The executor collects every agent whose `area` is `planning` as candidates. A selector
picks one — deterministically by designation if an agent is marked `default_planner`, else first
by name, or by a model call if the LLM selector is wired. The chosen planner runs a journaled
ReAct loop and emits a plan.

> **Discovery (wired since gateway v0.11.0).** The planner introspects the registry while
> planning through `list_agents`, `list_skills`, `list_tools`, `list_chains` and
> `validate_plan`. `Executor::pinned` composes all five per run, over the registry that run is
> pinned to, whenever the executor has a registry handle — which `torii`'s `boot::heavy` always
> sets, so every `run submit` and `worker serve` drive has them. They are not granted to anyone
> by being registered: like any tool, a planner agent must **declare** each one it may call in
> its `tools:` frontmatter, and the registry must carry the matching `tools/<name>.json` schema
> (the registry refuses an agent that names a tool it does not define). All five are `Pure`.

**Gate the plan.** The plan passes a pure feasibility check before anything executes — reserved
ids, node counts, references that resolve.

**Execute.** The orchestrator drives the plan's nodes. Each agent node assembles a prompt from its
system prompt plus its activated skills plus resolved upstream context, routes through its chain
to a model, and may call its declared tools. Every effect is journaled by class: `Pure` memoizes
and replays, `Observation` may refresh, `Mutation` is two-phase with an idempotency key so a crash
mid-write reconciles rather than double-applies.

**Pause for a human, durably.** A `HumanGate`, an `AwaitSignal`, or a human-backed agent suspends
the run to the database. It can be resumed in a different process, days later, with no tokens
re-spent.

**Replan.** Wrapping the above in a `Loop` whose gate is an agent gives plan → execute → gate →
replan: the coordinator pattern.

---

## 3. The domain model a designer must encode

Four entity types, authored as a set, pushed atomically.

```
<root>/agents/*.md     frontmatter + body (= system_prompt)
<root>/skills/*.md     frontmatter + body (= the skill text)
<root>/tools/*.json    a ToolSpec
                       chain bindings belong to the same config set
```

| entity | fields |
|---|---|
| **Agent** | `name` · `area` · `kind` · `chain?` · `chains: {phase → chain}` · `tools: [name]` · `skills: [name]` · `grants: {tool → Permissions}` · `system_prompt` · `backed_by: Model \| Human{timeout}` · `default_planner: bool` |
| **Skill** | `name` · `description?` · `body` · `activation: Always \| OnKeywords([kw])` |
| **Tool** | `name` · model-facing JSON schema · effect class `Pure \| Observation \| Mutation` · `activation` · declared `credentials` refs |
| **Chain binding** | `(area, kind) → chain` |

`area` and `kind` are the routing vocabulary: an agent declares a role, and a binding maps that
role to a model chain, so one edit re-points every agent of that role. `area: planning` is
load-bearing — it is the only role string the engine itself reads.

---

## 4. Invariants that constrain the UX

These are not preferences. Each one is a verified behaviour that will bite a naive design.

**Referential integrity is enforced at load, not at use.** An agent listing a tool or skill that
does not exist makes the *entire config* fail to assemble. The UI must offer selection from
existing entities; free text guarantees a rejected push.

**A chain id is a string the registry cannot validate.** It resolves later, in the gateway,
against a separate catalog the config path does not read. A mismatch is not caught at push unless
the catalog is supplied — it surfaces mid-run as a terminal failure naming neither cause nor
remedy. The UI must cross-check and show both sides.

**Push is replace-all.** What is in the set becomes the config; anything absent is deleted.

**Any successful push terminally kills every already-paused run.** The push advances the config
generation, and a paused run's fence no longer matches, so it fails on its next wake and cannot be
resumed. This is correct behaviour — it prevents a silent wrong-config resume — which means the
answer is disclosure and consent, never a weaker fence. **This is the most dangerous action in the
product and the UI's primary safety obligation.**

**A push reaches running workers without a restart** (AG-5, torii#34). `worker serve` checks the
durable generation before every tick and reloads the registry when a push has moved it; the next
drive runs on the pushed registry, while a drive already in flight finishes on the generation it
pinned. Before this, a long-running worker kept its boot generation and failed every run submitted
after a push at the fence. The gateway catalog is NOT reloaded — a worker reads it once, at boot —
so a push that depends on a chain added to the catalog since needs a worker restart, and the
worker logs exactly that.

**A transient provider failure pauses, not fails** (AG-5). torii boots every driver with
transient retry ON at 3 attempts (`TORII_TRANSIENT_ATTEMPTS`; the gateway's own default is off): a
provider 500 pauses the run on a short backoff and a worker re-attempts it. The memory backend is
the exception — unset, it keeps retry off: nothing that could wake a pause there outlives the
process. More generally, **on memory no pause can be resumed** — not a timed one (retry, a 429
that gates every candidate) and not a human one (signal, gate, agent answer, tool
confirmation, budget cap), since every waker is another process and sees an empty store — so
`run submit` prints the pause there at exit 2, never 0. On Postgres a pause is exit 0. A run view should show that pause as "retrying (attempt n of N)" rather than as a stall —
`run_results` marks the node `retrying` for exactly that.

**Effect class decides replay semantics.** `Pure` is memoized and never re-executed; `Mutation`
gets two-phase commit and an idempotency key. Choosing it wrongly is a correctness bug, not a
preference, so it must be presented as consequential.

**A declared tool needs an executable counterpart.** A schema the runtime cannot serve is a tool
the model will call and fail on — a burned turn. The UI should show which declared tools are
actually backed.

**A tenant is named by its id or its slug, and the two cannot collide.** Every command acts for
one tenant (`TORII_TENANT`), given either way. A slug is never UUID-shaped — the database refuses
one (`tenants_slug_not_uuid`), and an org named after an id gets an `org-`-prefixed slug — so an
id always means its own tenant. A tenant picker can accept either without disambiguating.

**A human-backed agent resolves no chain.** `backed_by: Human` changes the semantics: a person
answers, there is no model call, and the chain rules do not apply. The form must change shape.

---

## 5. seiki — the administrative screens

Each entry is the goal, then the props a component would take.

### 5.1 Registry overview
The operator's home. Shows the four collections with counts, the durable config generation, and
whether the working set differs from what is deployed. It exists to make "what is live, and what
would change if I pushed" answerable at a glance. `torii config show` (AG-6) backs the first half
— the live registry and its generation as JSON, from one snapshot; the second half still needs a
diff that does not offer to write (`config push` prints its diff only as it applies).

```
{ generation, entities: { agents, skills, tools, bindings }[],
  dirty: boolean, pausedRunCount, lastPush: { at, by, generation } | null }
```

### 5.2 Agent editor
Author one agent. The difficulty is references, not fields: tools and skills must be chosen from
what exists, grants are per-tool runtime ceilings, and `backed_by: Human` switches the form to a
different shape with no chain. The editor should make an invalid agent unrepresentable rather than
letting the push reject it.

```
{ agent: AgentDefinition, availableTools: ToolSpec[], availableSkills: SkillDef[],
  availableChains: string[], onChange, errors: FieldError[] }
```

### 5.3 Skill editor
Author a skill and, critically, its activation. Absent activation means the skill is composed into
*every* prompt for every agent that lists it; a keyword list makes it conditional. The screen
should surface how many skills are unconditional, because that is the cost driver for a large
library.

```
{ skill: SkillDef, activation: { mode: 'always'|'keywords', keywords: string[] },
  unconditionalCount, onChange, errors }
```

### 5.4 Tool editor
Declare a tool's schema, effect class and credential refs. Effect class is the highest-stakes
field on the screen and should read as a decision with consequences, not a dropdown.
`executableExists` warns when a schema has no runtime counterpart.

```
{ tool: ToolSpec, schema: JSONSchema, effectClass: 'Pure'|'Observation'|'Mutation',
  credentials: string[], activation, executableExists: boolean, onChange, errors }
```

### 5.5 Chain bindings
Map `(area, kind) → chain` and validate every id against the gateway catalog. This screen exists
because of a real failure mode the registry cannot catch on its own.

```
{ bindings: ChainBinding[], gatewayChains: string[],
  unresolved: { source, chainId }[], onChange }
```

### 5.6 Push review — the consent screen
The most important screen in the product. Full diff, plus a plain statement that the push is
replace-all *and* will terminally kill N named paused runs. Must not be dismissible unread, and
must refuse outright while chain ids are unresolved.

```
{ diff: { added, changed, removed, unchanged }[], currentGeneration,
  pausedRuns: { runId, node, pausedSince }[], unresolvedChains: [...],
  requiresConfirmation: boolean, onConfirm, onCancel }
```

---

## 6. torii — the operating screens

### 6.1 Submit a goal
Start a run: a goal, the graph or template, an optional token budget, an optional workspace root.
For the planner path the user supplies a goal and the system selects a planner — so the screen
should show *which* planner would be chosen and why, before committing spend.

```
{ goal: string, graph: Graph | templateId, budgetTokens?: number,
  workspaceRoot?: string, plannerPreview: { selected: AgentRef, reason, candidates: AgentRef[] },
  onSubmit }
```

### 6.2 Run detail / journal timeline
What happened, in order, with what it cost: nodes, effects and their classes, token spend, the
expanded plan if there was one, and where the run is now. Without this a failed run is a terminal
error string.

```
{ runId, status, timeline: { seq, event, nodeId, effectClass, tokens, at }[],
  plan?: PlannedGraph, budget: { spent, cap } | null, fence: string }
```

The per-node outputs half of this screen is backed: `torii_core::results::run_results` returns
`{ run, status, as_of, nodes: { node, state: completed|failed|retrying|skipped, stored:
inline|cas{digest, size}, output, unresolved, error }[] }` (`torii run results --json` prints
exactly that). A node's `error` is its LAST failure — under transient retry the earlier ones are
"retrying" notices — so a failed run's node names the same error `run status` does; a node whose
last attempt failed transiently and whose run is paused for the retry is `retrying`, not `failed`.

### 6.3 Plan review
Inspect a plan the planner produced before or during execution — nodes, their agents, dependencies,
and the feasibility verdict. This is where a human judges whether the machine understood the goal.

```
{ plan: PlannedGraph, feasibility: { ok: boolean, reasons: string[] },
  nodes: { id, agent, dependsOn, status }[], onApprove?, onReplan? }
```

### 6.4 Intervention queue
Where agentic execution actually needs a person: every run awaiting a signal, a gate decision, or
a human-backed agent answer, with enough context to decide without leaving the screen. This is the
difference between a system that pauses safely and one a human can unblock.

```
{ paused: { runId, nodeId, kind: 'signal'|'gate'|'agent', question, options?,
            deadline?, pausedSince }[],
  onSignal, onGate, onAnswer, onCancel, onWake }
```

### 6.5 Budget and spend
Token spend per run and against a cap, with the pause-on-exhaustion state surfaced. A budgeted run
pauses durably when it hits its cap and can be resumed with a raised one — that is a workflow, and
it needs a screen.

```
{ runs: { runId, spent, cap, status }[], onRaiseCap }
```

---

## 7. What the code cannot back yet

Honest gaps between these screens and the engine, so nobody designs against a fiction.

| screen | gap |
|---|---|
| all of seiki | **Closed by AG-6 (torii#35).** `torii config show` prints the live registry and its generation as JSON from ONE `load_versioned` snapshot, and `torii config pull <dir>` writes it as the `agents/ skills/ tools/ chains.json grants.json` directory `config push` reads — a pull followed by a push of it is a no-op, per tenant, proven at the binary on Postgres. Both live in `torii_core::registry_dir`, so the API can serve the same read without a second implementation. What remains for an editor is a dry-run diff (push prints its diff only as it applies). |
| 5.6 push review | The paused-run count is available, but per-run detail for the warning list needs `list_paused`, which exists — this one is close. |
| 6.1 submit | `plannerPreview` has no backing. Nothing exposes "which planner would be selected for this goal" without running the expand. |
| 6.2 timeline | The journal is durable and complete, but there is no read API shaped for a timeline view. What a run PRODUCED is readable: `torii run results <id>` (AG-4, torii#33) returns each node's state and output — the executor's round checkpoint, with CAS refs resolved through the tenant's content store — from `torii_core::results::run_results`, the read the API will share. The ordered event timeline is still missing. |
| 6.3 plan review | Plans are journaled; approving or rejecting one interactively is not a mechanism that exists. |
| 6.4 interventions | Best-supported screen — `list-paused`, `signal`, `gate`, `agent`, `wake`, `cancel` all exist as commands. |
| planner quality | No longer a code gap: the five discovery tools are composed per run (gateway v0.11.0). What remains is content — no shipped planner agent declares them, and no shipped `tools/*.json` defines their schemas (see the absent default content below). |

**Revised assessment.** With the read path already present below the CLI, the largest genuine
blocker is the **absent default content**, without which a fresh install cannot plan at all —
including a planner agent that declares the discovery tools, which have been wired since gateway
v0.11.0 but do nothing for an agent that does not declare them.
Reading the durable config back out is done: `config show` / `config pull` (AG-6).

---

## 8. Open decisions

1. **Does torii gain a UI, or stay a CLI?** Everything above assumes a console. If it stays CLI,
   these become command and output designs instead.
2. **Are seiki and torii one app or two?** Administration and operation have different audiences
   and different blast radii — the push screen can destroy in-flight work, the intervention queue
   cannot.
3. **What content ships by default?** Still open, and it gates the registry work: without a
   shipped planner agent, a fresh install cannot plan at all.
4. ~~**Expose the durable config for reading?**~~ Decided and built (AG-6, torii#35):
   `torii config show` (JSON + generation, one snapshot) and `torii config pull <dir>` (the
   directory `config push` reads; pull-then-push is a no-op), over `torii_core::registry_dir`.
