# torii

> **Moved here from the gateway** (`sensei-hq/gateway` `crates/torii`, with its history) — epic
> [sensei-hq/gateway#76](https://github.com/sensei-hq/gateway/issues/76), TM-8
> ([#26](https://github.com/sensei-hq/torii/issues/26)); `docs/DECISIONS.md` §11: the gateway is a
> library, torii owns persistence. It reads torii's database through `torii-core` — the same layer
> the API (`services/gateway`) uses — so the CLI and the API share one config and one store
> implementation.

The operator control plane for the sensei orchestrator: submit and observe runs, intervene on the
ones waiting for a human, drive due wakes, and manage the durable registry config.

Everything below was verified against the built binary and the source, not from memory. Where the
toolkit does not yet do something, it says so rather than describing an intention.

## What you need first

| | |
|---|---|
| **torii's database** | The orchestrator's registry (`registry.*`) and run state (`runs.*`) live there, per tenant, beside the catalog. Apply the schema with `dbd` from `database/` (see `database/README.md`), RLS policies included. |
| **`DATABASE_URL`** | Environment only. There is deliberately no flag: a flag would leak the password into `ps`. |
| **`TORII_TENANT`** | The tenant every command acts for — its id or its slug. A slug can never look like an id (the database refuses a UUID-shaped slug, and org create turns a UUID-shaped name into an `org-`-prefixed slug), so an id always names its own tenant. Required on the Postgres backend: every run, journal and registry belongs to exactly one tenant, and another tenant's are invisible. |
| **`TORII_FENCE_VERSION`** | Needed by `run submit` and `worker serve`. Set it **explicitly** (e.g. `v1`) and keep a fleet agreed on it — it is recorded in every run and checked on resume, so deriving it from a build version would strand every paused run on a routine deploy. |
| **`TORII_POOL_SIZE`** | Optional. Defaults are fine to start. |
| **`TORII_WAKE_MAX_ATTEMPTS`**, **`TORII_WAKE_BASE_BACKOFF`**, **`TORII_WAKE_MAX_BACKOFF`** | Optional (defaults `5`, `30s`, `60m`). How a wake that keeps failing is retried: a retryable drive error (a journal or store backend fault) or a worker lost mid-drive re-schedules the run after a backoff that doubles from the base up to the ceiling; the attempt past the cap is never driven — the run is filed `failed`, naming the count and the last error. A successful drive resets the count. Backoffs take `--interval`'s units (`500ms`, `30s`, `15m`); `0` attempts and a base above the ceiling are refused. Read only by the two commands that drive (`worker serve` and `run submit`), so keep a fleet agreed on them; a bad value fails those two, loudly, and no other command reads it (`run status`, `run list-paused`, `run cancel` and the answering verbs still work while you fix it). |
| **`TORII_BACKEND`** | Optional: `postgres` (the default — everything above applies) or `memory`. `memory` keeps every store in the process — no database, no `DATABASE_URL` — for development and CI. Nothing survives the process, so a run it submits can only be observed or woken by that same process. |
| **`TORII_REGISTRY_DIR`** | With `TORII_BACKEND=memory`: the registry directory (the `agents/ skills/ tools/` layout `config push` reads) loaded at boot, since there is no database to push to. |
| **A gateway config** | On Postgres: **torii's catalog** — routers, models and chains, read by the same `torii_core::load_gateway_config` the API routes with. Nothing to pass; a `--gateway-config` there is refused. With `TORII_BACKEND=memory` only: `--gateway-config <file>` (JSON), required by `run submit` and `worker serve`. |

## The gateway config

On the Postgres backend it is **torii's catalog** (`catalog.routers / models / chains`, the platform
tenant's) — there is one, and the API routes with the same one.

With `TORII_BACKEND=memory` there is no catalog, so `--gateway-config <file>` supplies it:
`GatewayConfig` (`kernel::types::config`) as JSON with `routers`, `models`, `chains`, plus optional
`constraints`, `panels` and consensus workflows. `ollama` registers without credentials, which is
convenient for a first boot:

```json
{ "routers": { "ollama": { "url": "http://127.0.0.1:11434" } } }
```

> **Know this before you author agents.** An agent's `chain`, its per-phase `chains`, and every
> `(area, kind)` chain binding are **strings** resolved against the gateway config's `chains`. Two
> checks keep them in step: `torii config push` refuses a registry that names a chain the catalog
> lacks (always, on Postgres; with `--gateway-config` on memory), and `run submit` /
> `worker serve` **always** refuse to boot on one — naming each missing chain and the agent, phase
> or binding that names it — rather than letting every run that reaches it fail with no candidates.

## The registry directory

`torii config push <dir>` reads exactly three subdirectories:

```
<dir>/agents/*.md     # frontmatter: name, area, kind, chain | chains, tools, skills,
                      #              backed_by, timeout, default_planner, tool_limits,
                      #              confirm_tools, confirm_timeout, escalate_to
                      # body = the agent's system_prompt
<dir>/skills/*.md     # frontmatter: name, description, activate_on: [kw, ...]
                      # body = the skill text composed into the prompt
<dir>/tools/*.json    # a ToolSpec: the model-facing schema + effect class
```

Flat globs — a `skills/foo/SKILL.md` one level deeper is **not** read.

`activate_on` as a list makes a skill conditional (`OnKeywords`); absent means always. A *scalar*
`activate_on` is a loud parse error rather than a silent "always", so a forgotten pair of brackets
cannot quietly disable the gate.

`backed_by: human` makes the agent a human role rather than a model one, with an optional
`timeout: 48h` SLA; a `timeout` without it is a loud parse error, because a model-backed agent has
no SLA to wait on. `default_planner: true` designates **the** `area: planning` agent that a
`PlannerRef::Select` node picks, instead of letting the alphabetically-first name win — at most one
agent may carry it, a second is refused at load, and it is refused outside `area: planning`, where
it would designate nothing. Both keys are read literally: `default_planner: yes` is a loud parse
error, never a silent "unmarked".

Tool policy and escalation (gateway AG-15): `tool_limits: [shell=3]` caps how many times one
invocation of the agent may call a tool (further calls are refused to the model as
`call_limit_reached`); `confirm_tools: [deploy]` makes every call of a listed tool wait for a person
(`torii run tool approve|reject`), up to `confirm_timeout: 2h` if given, after which the model is
told `not_confirmed`; `escalate_to: legal-lead` hands a human-backed agent's unanswered question to
another human-backed agent when its `timeout` expires. Every one names only tools the agent lists,
and `config push` refuses a malformed or impossible policy (a ceiling of 0, a confirmation on an
unlisted tool, an escalation from a model-backed agent or round a cycle) at load.

Per-tool `grants` are **not** agent frontmatter. They live in the registry root as
`<dir>/grants.json` (`{"<agent>": {"<tool>": <permissions>}}`), beside the optional
`<dir>/chains.json` of `(area, kind) → chain` bindings.

A shipped `tools/*.json` declares a schema the model may call. The executable side must exist too —
`torii` wires `fs_read`, `fs_write` and `shell`, and (since gateway v0.11.0) every drive also
composes the five planner discovery tools — `list_agents`, `list_skills`, `list_tools`,
`list_chains`, `validate_plan` — over the registry that run is pinned to. Wired is not granted: an
agent can call one only if it declares it in `tools:` and the registry carries its
`tools/<name>.json` schema, exactly as for any other tool. A schema with no executable counterpart
is a tool the model can call and the runtime cannot serve.

## The flow

```sh
export DATABASE_URL=… TORII_TENANT=acme TORII_FENCE_VERSION=v1

# 1. push your registry — replace-all; it advances THIS tenant's config generation
torii config push ./registry
torii config version

# 2. run something
torii run submit --graph ./graph.json

# 3. or serve this tenant's wakes continuously
torii worker serve
```

**`config push` is replace-all.** What is in the directory becomes the durable config; anything
absent is removed. It asks for confirmation before removing entities, and before advancing the
generation while runs are paused — `--yes` bypasses both, which is what a CI push needs, since the
interactive prompt refuses on EOF.

**Any successful push terminally kills every already-journaled paused run of that tenant**, because
the generation it advances is part of the fence those runs resume against. Other tenants' runs are
untouched — the generation is per tenant, and only a registry push moves it (a catalog edit does
not). `torii run list-paused` before pushing.

A worker serves **one tenant** (`TORII_TENANT`): its sweeps claim only that tenant's due runs.

## Observing and intervening

```sh
torii run status <id>            # one run's schedule record (+ token/money spend, wake attempts,
                                 #   pending tool confirmations and escalations)
torii run list-paused            # everything awaiting a wake, and what each run waits on
torii run signal <...>           # deliver a decision to an AwaitSignal node
torii run gate <...>             # decide a HumanGate or a Loop's human gate
torii run agent <...>            # answer a human-backed Agent — a role a person fills
torii run tool approve|reject <id> --call <effect_id>
                                 # decide one confirm-before-run tool call
torii run wake <id>              # queue a paused run for the next worker tick
torii run cancel <id>            # cancel a non-terminal run so it is never woken
torii run prune --older-than <>  # delete terminal run records
```

**Budgets.** `run submit --budget-tokens N` caps a run's tokens and `--budget-usd D` its money
(whole micro-dollars: at most 6 decimal places, refused rather than rounded); either, both or
neither. A run that stops at a cap pauses, `run status` shows the spend against it, and `run wake
--budget-tokens`/`--budget-usd` moves the cap before re-queueing. A money raise only moves a cap the
run was SUBMITTED with — on a run without one it is refused and nothing is written. Under a money
cap every model on the chains the run uses must declare pricing (an explicit zero for a free or
local model); an unpriced one is refused.

**Confirmations and escalations.** A `tool:` row in `list-paused` (and a `tool confirmation
pending:` line in `status`) is one call of a `confirm_tools` tool waiting for a person; answer it
with `run tool approve|reject <id> --call <effect_id>`. A call past its deadline, already decided,
or already settled is refused before anything is written. An escalated question shows its current
holder (`agent (escalated to <agent>):`) and that hop's deadline, and is answered with `run agent
answer` as before. `--as` on every verb is attribution, not authentication.

Exit codes: `0` ok · `1` error, including a run that executed and failed · `2` not-found,
precondition-not-met, or a result printable but not the unqualified success you asked for. Exit 1
writes to stderr and nothing to stdout; exit 2 still prints its result. Note `2` is also clap's
usage-error code, so a script keying off it should check stderr too.

Logs go to **stderr** via `RUST_LOG` (default `info`), never stdout, so `--json` output stays clean.

`run submit` and `worker serve` also log every human-in-the-loop moment their drives report — a
node starts waiting (signal, gate, agent question, loop gate, tool confirmation), a decision is
honoured, a question is escalated — as one line per event at target `torii::run_event`, the event's
JSON in `event` (e.g. `{"run":"…","type":"signal_received","node":"gate","payload":{…}}`). It is
best-effort: a drive never waits on the log, and an event the log cannot keep up with is dropped
and counted in a warning. `RUST_LOG=torii::run_event=info` shows only these.

## Known gaps

Stated because finding them by experiment is worse.

- **No registry content ships.** There are no built-in agents, skills or tools — you author all of
  them. `torii worker serve` refuses to boot against a registry with zero agents.
- **No `config init`, `config pull` or `config diff`.** `version` and `push` are the whole config
  surface today.
- **With nobody marked, two planner agents resolve by name order.** Mark one `area: planning`
  agent `default_planner: true` and it is chosen; leave every agent unmarked and the selector
  still takes the first by name.
- **No release artifact.** There is no published crate or container, so `torii` is built from a
  checkout.

For the design record behind these, see the gateway's
[`docs/analysis/2026-09-14-sp-reg-1-registry-content.md`](https://github.com/sensei-hq/gateway/blob/main/docs/analysis/2026-09-14-sp-reg-1-registry-content.md).

## Tests

`cargo test -p torii-cli` runs everything that needs no database and reports the rest `ignored`.
With `DATABASE_URL` pointing at a torii database (schema applied **and** seeded — the boot tests
bind the catalog's `chat` chain), every test runs: each creates a tenant of its own and removes it
afterwards, so they run in parallel with no shared lock. `tests/postgres_backend.rs` drives the real
binary end to end; `tests/e2e_pg.rs` the cross-process operator loop.
