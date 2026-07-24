# O2 · Analytics & cost insights

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Ops · **Status:** Planned · **Depends on:** C1, C3

## Purpose

Turn the ledger into the dashboards that justify the product — cost down, work never stops.

## What we build

- **Reads the one authoritative ledger** — the crate-native **`inference_calls`** (`service_role`-write) plus **`quality_signals`** (§3b); there is no separate cost table (`gateway_tasks` cost fields are retired).
- **Cost trend** (blended cost/call), **model mix**, **local-vs-cloud savings** (the plane split), **fallback** counts, **latency** (p95), and **quality** (grounding / LLM-judge score, guardrail/redaction-hit rate) from `quality_signals`.
- Overview stat cards and "most-used models"; spend rollups per scope (org/dept/team/user).
- Aggregation via materialized views / rollup tables for cheap reads.

## UI surfaces

- Overview (W1); spend chips + Activity (W2).

## Reuse / source

`database/` — the consolidated **`inference_calls`** ledger + **`quality_signals`** (§3b), **not** the retired `gateway_tasks`; mockup Overview (`view-overview.jsx`); C3 spend rollups.

## Open questions

- Precomputed rollups vs on-the-fly; how local ($0) calls factor into "savings".
