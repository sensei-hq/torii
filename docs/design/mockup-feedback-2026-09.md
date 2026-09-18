# Mockup feedback — September 2026

> **For:** the designer, to update the mockups in the claude.ai design project.
> **From:** a pass over the imported mockups against what the system can actually serve,
> after the G1–G3 schema work (2026-09-17/18).
>
> Written to be readable without knowing the database. Where a field is "backed", it means the
> data genuinely exists and a screen can show a real number today — not that it is wired yet.

---

## How to read this

Each screen has up to four parts:

- **Now backed** — the mockup already shows this and it was previously fiction. It is real now;
  keep it, and treat the mock as the spec.
- **Add** — something the system can serve that the mockup does not show.
- **Not backed** — the mockup shows something nothing can supply. Either cut it, or mark it
  explicitly as future so it does not read as shippable.
- **Decide** — a question only you (or Jerry) can answer.

---

## 1. Models — better news than the last audit

The previous audit said *"catalog schema has no tier/price/quality/latency fields"*. That was
wrong. **Every column the Models mock shows is backed:**

| mock column | backed by | status |
|---|---|---|
| Tier | tier membership, curated ∪ attribute-derived | ✅ **new** (G2) |
| $ / 1M | per-endpoint input/output token pricing | ✅ already existed |
| Quality | daily judge score, thumbs, ratings | ✅ already existed |
| Latency | rolled-up daily latency | ✅ already existed |
| Context | model context window | ✅ already existed |

**So the Models screen needs no design change to be truthful — it needs wiring.** Treat the
mock as correct.

**Add — free-tier economics.** This is new and has nowhere to live yet:

- **Free allowance + what's left** — e.g. "38M of 60M left this month". Free tiers *reset*, so
  this is a windowed number, not a running total.
- **Shared-quota pools.** Several models can draw on **one** allowance. Two models showing
  "60M" each may be sharing a single 60M. The UI must make that visible or the operator will
  plan against a number twice the real one. Suggest a pool badge on each member and a single
  headroom figure for the pool.
- **Uncapped tiers.** Some models are free with no cap. Show them as *unlimited* — **never as
  0 or 100%**, which reads as exhausted and would steer people away from a free model.
- **"Trains on prompts"** — a privacy flag that belongs next to the allowance, because that is
  the moment someone is deciding to use the free tier.
- **Terms verdict** — `ok` / `caution` / `ambiguous`, for whether routing an org's traffic
  through this free tier is within the provider's terms. A badge is enough; it is a legal
  exposure, not a nicety.

**Add — "Refresh from routers"** already has a working endpoint and no button.

---

## 2. Routing — the four cards that were "no backend" now have one

**Now backed (all previously blocked):**

- **Routing policy** — retries, backoff, timeout, plus cooldown/lockout durations and jitter.
- **Provider health** — per-provider state.
- **Per-router overrides** — on Connections.
- **Chain assignments.**

**Add — tiers, which change what a chain *is*.** A chain step can now be **either** a concrete
model **or** a whole tier. This is the significant one for design:

- A tier step means *"any model in this segment, in this order"* — so adding a model to a tier
  updates **every chain that references it**, with no chain edit. The mock's step list assumes
  one step = one model; it needs a second step shape.
- Each tier carries an **ordering strategy**: by priority, by cost, by most headroom, or by
  least used. Show it on the step.
- ⚠️ **Two of those four are not live in the engine yet** (headroom and least-used fall back to
  priority). If the UI offers all four equally, it promises behaviour that silently does not
  happen. Mark them, or hide them until they land.

**Decide — where tiers are edited.** They are catalog-wide but chains are per-tenant. Is the
tier editor its own screen, a section of Routing, or part of Models?

---

## 3. Overview — mostly a wiring job

**Now backed:** the cost-trend sparkline, the gateway-vs-on-device split, model mix, and the
quality summary all have working endpoints and no consumer. **7 of 8 analytics endpoints are
built and unused.** The mock is right; nothing here needs redesign.

**Add:** a free-tier headroom tile — "you have 40M free tokens left this month" is a genuinely
useful glanceable number and is now computable.

---

## 4. Registry (new) — three of five screens exist

The mock covers **Agents**, **Skills** and **Publish**. Two are missing:

- **Tool editor** — declaring a tool's schema, its **effect class**, and its credentials.
- **Chain bindings** — mapping a role to a model chain.

**Effect class deserves care.** It is `Pure` / `Observation` / `Mutation`, and it decides
whether a step can be safely repeated. Choosing it wrongly is a **correctness bug, not a
preference** — a `Mutation` marked `Pure` can be silently replayed, sending the same email
twice. It should read as a consequential decision, not a dropdown. The `PLAIN` vocabulary
already in the mock ("changes something", "reads", "reads nothing") is the right instinct —
carry it into the tool editor.

**Publish — ratified since the mockups were drawn.** Your per-entity staging model (publish one
agent, with its own in-flight count) is the agreed direction, and torii will hold that staging.
The engine underneath still swaps a whole set at once, so:

- Per-entity staging rows: **keep**.
- The **blast radius** of a publish is the **org subtree**, not the whole workspace. That is now
  decided and should be stated plainly on the consent screen.
- Keep the warning that publishing can terminate paused runs, and name them.

**Decide:** does the publish screen show *"this will affect Finance and everything under it"*
as a tree, a count, or a named list?

---

## 5. Runs & approvals (new) — one correction

The design is sound. One thing to change:

- **Planner preview** — "which planner would be chosen, and why, before I commit spend" has
  **no backing and no plan to build one**. Either cut it, or show it as an explicit
  post-submission explanation rather than a pre-flight prediction.

**Now backed:** the intervention queue, the run journal, per-run spend against a cap, and the
kill switch all map to real mechanisms.

**Keep as-is:** *"A run debits the same budget node as a question."* That is the correct model
and matches how spend is actually enforced.

---

## 6. Tools & MCP — the model changed under this screen

The new mock moves tool permissions onto the **org tree**, and the ratified rule is
**org tree *plus* roles** — a grant is "this role, at this point in the org, may call this
tool". The built screen still shows a flat tools × roles matrix.

**This needs a redesign pass**, not a tweak: a flat matrix cannot express inheritance down the
tree. Suggest showing the effective grant at a node with its inherited-from source, the way the
agent editor shows a resolved chain read-only.

---

## 7. Screens that still do not exist

- **Spaces & KB** — the largest gap. All six document endpoints and the retrieval-config
  endpoint are **already built and unused**. This is the single highest-value screen to design
  next; it unblocks Torii's whole RAG story.
- **Templates** — no table, no endpoint, no route. Needs a backend decision before design.
- **API keys** and **Alerts** — exist as fragments inside other screens; both warrant their own
  route.

---

## 8. Corrections to carry back

1. **Models economics is real** — remove any "future"/"coming soon" treatment.
2. **Free-tier allowances are pooled and windowed** — never sum them across models, never show
   a running total without a window.
3. **Uncapped ≠ zero.**
4. **Two intra-tier strategies are aspirational** — do not present four equal options.
5. **Planner preview is not real** — cut or reframe.
6. **Tool grants are org-tree + role** — the matrix is superseded.

---

## Open questions

1. Where do tiers get edited — own screen, Routing, or Models?
2. How is publish blast radius shown — tree, count, or named list?
3. Templates: what is a template, concretely, before it can be designed?
4. Does the Models screen show per-endpoint pricing (a model can cost different amounts through
   different routers), or one blended number?

---

## Related

- `analysis/2026-09-17-seiki-torii-gateway-alignment.md` — screen map + engine contradictions
- `analysis/2026-09-17-gateway-features-to-torii-work.md` — the feature-by-feature work breakdown
- `DECISIONS.md` §11 — gateway is a library; torii owns persistence and configuration
