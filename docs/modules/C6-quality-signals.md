# C6 · Quality signals & interaction intelligence

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Central (C-plane, in the request path) · **Status:** Planned · **Depends on:** C1, C4, F1 · feeds O1/O2

> **Placement is provisional (DECISIONS §3b, confirm in step 4).** Default is this new **C6** owning the signals contract + the v2 mediator, with the `quality_signals` store in F1 and audit/analytics in O1/O2. The alternative is to distribute the same capability across C4/O1/O2 with no new module. If C6 is not ratified, fold these responsibilities into C4 (capture), O1 (audit) and O2 (analytics).

## Purpose

Capture **quality signals** on every interaction, **audit** them, and — forward-looking — use them to actively improve interaction quality via a component that sits **between the user and the gateway** as an optimizing go-between (§3b).

## Responsibilities

- Own the **quality-signal contract**; persist signals to the `quality_signals` store; stream to the immutable audit ledger (O1) and roll into analytics (O2); back the live quality meters.
- **(v2)** Run the adaptive **go-between mediator** that improves conversations in-flight.

## What we build

- **Signal capture (v1):** every call/message records **explicit** signals (user rating/thumb, accept/edit/retry, corrections) and **implicit/system** signals (grounding score, retrieval recall/precision, **LLM-as-judge** quality score, cost, latency, fallbacks taken, guardrail/policy hits, "why this model" trace). Governance application (masking / grounded-only / classification), C5 **W5 redactions**, and **§3c sensitive-data computes** all emit signals too.
- **`quality_signals` store (v1):** keyed to `inference_calls` / `messages`, `service_role`-write; streamed to O1 (immutable, SIEM-streamable) and rolled into O2 analytics.
- **Live surfacing (v1):** the Playground/Ask **live meters** (grounding / quality / cost / latency), the **quality-judge toggle**, and **auto-tune-prompt** already in the mockups are backed by this store.
- **Interaction intelligence / go-between (v2, forward-looking):** an inference/optimization layer consuming signal history + a model of user & LLM responses to **mediate and improve conversations in-flight** — query rewriting/decomposition/HyDE, clarifying questions, learned user/space preferences, prompt auto-tuning, model-selection tuning. **Agent-adjacent** (aligns with X2 agents = design-only v1 / runtime v2): **surfaces designed in v1, adaptive runtime ships with X2 in v2.**

## Key contracts / data

- **`quality_signals`** (F1, §5 delta): signal schema (explicit + implicit/system), keyed to `inference_calls` / `messages`, `service_role`-write.
- Read model for live meters; audit stream contract to O1; analytics rollup contract to O2.
- Consumes the C4 governance trace + LLM-as-judge result and the C1 "why this model" trace.

## UI surfaces

- Playground/Ask **live meters + quality-judge toggle + auto-tune-prompt** (W3/W2); analytics dashboards (O2); audit views (O1). The **v2 go-between/mediator surfaces are designed in v1** (agent-adjacent), runtime deferred to v2.

## Reuse / source

C4 governance trace + LLM-as-judge; C1 "why this model" trace; O1/O2 ledger + analytics; the crate-native **`inference_calls`** ledger (single authoritative ledger, §3). Engine = the six `sensei-*` crates @ **`v0.4.6`**. DECISIONS §3b (+ §3a/§3c signals feed in).

## Open questions

- **Module placement** — new C6 vs. distribute across C4/O1/O2 (default is C6; confirm in step 4).
- LLM-as-judge model + prompt + cost budget for judging (judging is itself a metered inference call).
- Signal schema versioning/stability as new detectors and meters are added.
- Where the v2 mediator sits relative to C4 governance and C2 routing in the request path.

## Tiering

- **v1:** signal capture + audit + live meters + judge/auto-tune toggles.
- **v2:** the adaptive go-between optimizer (surfaces designed in v1, runtime with X2).
