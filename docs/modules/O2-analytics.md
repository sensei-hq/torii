# O2 · Analytics & cost insights

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Ops · **Status:** Built (P12, 2026-08-03) · **Depends on:** C1, C3

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

**Resolved** (P12; see spec [`../specs/O2-analytics.md`](../specs/O2-analytics.md) §8):
- ~~Precomputed rollups vs on-the-fly~~ — both: day-or-coarser dashboard reads hit the live `analytics_*` rollups (incremental on ledger insert via triggers); ad-hoc ranges + `spend`/`plane-split` run on the fly against `inference_calls`. Rollups are a reconstructable cache reconciled against the immutable ledger.
- ~~How local ($0) calls factor into "savings"~~ — the cloud-equivalent baseline prices a local call's actual tokens at the **cheapest priced cloud step** in its chain (`analytics_cloud_equiv`); local-only chains and unpriced counterfactuals are surfaced separately, never guessed.

**Still deferred** (spec §10): per-tenant effective/BYOK cloud pricing for the savings baseline (v1 uses catalog list pricing); session-only Playground experiment counting (tied to C6 §10); long-horizon month-grained rollups + retention past 90 days; exact (vs approximated) p95/p99 on precomputed dashboards. Operational: `pg_cron` MV-refresh/reconcile schedule not yet enabled.
