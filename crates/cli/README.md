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
| **`TORII_TRANSIENT_ATTEMPTS`** | Optional (default `3` on Postgres, `1` on `TORII_BACKEND=memory`). Total attempts a model call gets when the provider fails in a way the gateway reports as retryable (a provider 500, say) before the node fails. Between attempts the run **pauses** on a backoff (2s, doubling, capped at 60s) and a worker re-attempts it on that wake — so on Postgres a `run submit` whose call hits one prints `paused`, and `worker serve` finishes it. On memory nothing outlives the process, so no worker could ever wake that pause: retry is off there unless this is set, and the same 500 fails the run (`run submit` exits `1`). `1` turns retry off (the gateway's own default); `0` is refused (there is no "unlimited"), as is anything past `20`. Auth and credit failures never reach this path: they pause for a person instead. Like `TORII_WAKE_*` — and the two below — read only by `run submit` and `worker serve`, where a bad value fails loudly, naming the variable. |
| **`TORII_MAP_CONCURRENCY`** | Optional (default `8`). The ceiling on how many children of one `Map` node are in flight at once; each `Map` asks for its own `concurrency` and the lower of the two wins. Every in-flight child journals over the one `TORII_POOL_SIZE` pool, so a value far past it only queues children on connections. `0` and anything past `256` are refused. |
| **`TORII_WAKE_LEASE`** | Optional (default `60s`). How old a `waking` claim must be before a worker treats the worker that took it as lost and reclaims the run (each reclaim is a counted wake attempt — see `TORII_WAKE_MAX_ATTEMPTS`). Exclusion does not depend on it: a run being driven is locked, so a short lease cannot double-drive. `--interval`'s units; `0` is refused. |
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

**A running worker follows `config push`.** Before every tick `worker serve` checks the tenant's
durable config generation and, when a push has moved it, reloads the registry — no restart. The next
drive runs on the pushed registry; a drive already in flight finishes on the generation it pinned.
A registry that fails to load is logged and the last good one stays live. What a worker does **not**
reload is the gateway config: torii's catalog (routers, models, chains) is read once, at boot, so a
pushed registry that names a chain added to the catalog since is logged as an error naming the
chain — restart the worker to pick the catalog up.

## Reading the live config back

```sh
torii config show              # the live registry as JSON, with the generation it is at
torii config pull ./registry   # write it as the directory `config push` reads
```

**`config show`** prints `{"generation": N, "registry": {"agents": […], "skills": […], "tools":
[…], "chain_bindings": […]}}` — the registry and its generation from ONE snapshot, so a push
landing mid-read can never pair one with the other. Agents, skills and tools are sorted by name and
chain bindings by `(area, kind)`; each agent carries its `grants`.

**`config pull <dir>`** writes the layout above: `agents/*.md` and `skills/*.md` (frontmatter +
body, every key `push` reads — AG-15's included), `tools/*.json`, and `chains.json` and
`grants.json` in the root (always both). **A pull followed by a `config push` of the result is a
no-op** — `no changes`, no generation bump, no paused run touched. File names come from entity
names made safe (characters outside `A-Z a-z 0-9 - _ .` become `_`, a leading `.` gains a `_`,
and names equal but for case get `-2`, `-3` …); `push` reads only the extension, never the name.

- A non-empty `<dir>` is refused — exit 2, nothing written. `--force` removes the files a push
  reads there (`agents/*.md`, `skills/*.md`, `tools/*.json`, `chains.json`, `grants.json`)
  before writing and leaves everything else alone, so a stale agent from an earlier pull cannot
  come back as an addition.
- Every file is parsed back with `push`'s own reader before the first write. A value the
  frontmatter format cannot carry — a line break in a name, a comma or `=` inside a list item, a
  leading or trailing space, a value shaped like `[a list]`, a sub-second timeout, a body
  opening with a blank line — is refused naming the entity and the field (exit 1, nothing
  written), rather than pulled as something the next push would silently change. A registry
  authored through `push` never contains one.

Both read `TORII_TENANT`'s registry only; another tenant's never appears.

## Observing and intervening

```sh
torii run status <id>            # one run's schedule record (+ token/money spend, wake attempts,
                                 #   pending tool confirmations and escalations)
torii run results <id>           # what the run produced: each node's state and output
                                 #   (--node <id> for one, whole; --json)
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

**Results.** `run results <id>` prints one row per node — `completed`, `failed` (with the error
it stopped on, the one `run status` names), `retrying` (its last attempt failed transiently and
the run is paused for the retry; with that notice) or `skipped` — where its output is stored, and
the output itself, capped to one line;
`--node <id>` prints one node's output whole, `--json` the lot. The outputs are the executor's own
round checkpoint — the outputs the drive itself produced — so a human-answered node (a signal, a
gate, a human-backed agent) has its output too. One over the executor's 4096-byte threshold lives in
the tenant's content store (`cas <digest> <size>B`) and is read back from there. Outputs and errors
are redacted. Exit `0` is a completed run whose outputs all read back; a run not yet completed
still prints what it has produced so far (as of its last checkpoint) at exit `2`, as does an output
the content store cannot return. Another tenant's run is exactly an unknown run: exit `2`, `no such
run`, `null` under `--json`. Light tier: no gateway config, no credentials.

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
- **No `config init` and no dry-run diff.** `push` prints its diff as it applies (and asks before
  removing anything), but nothing shows the diff without offering to write it.
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
