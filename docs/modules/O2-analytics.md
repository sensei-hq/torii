# O2 · Analytics & cost insights

**Plane:** Ops · **Status:** Planned · **Depends on:** C1, C3

## Purpose

Turn the ledger into the dashboards that justify the product — cost down, work never stops.

## What we build

- **Cost trend** (blended cost/call), **model mix**, **local-vs-cloud savings**, **fallback** counts, **latency** (p95).
- Overview stat cards and "most-used models"; spend rollups per scope (org/dept/team/user).
- Aggregation via materialized views / rollup tables for cheap reads.

## UI surfaces

- Overview (W1); spend chips + Activity (W2).

## Reuse / source

`database/` `gateway_tasks`; mockup Overview (`view-overview.jsx`); C3 spend rollups.

## Open questions

- Precomputed rollups vs on-the-fly; how local ($0) calls factor into "savings".
