# O2 · Analytics & cost insights — Spec

**Module:** [O2](../modules/O2-analytics.md) · **Plane:** Ops · **Status:** Planned — build-ready
**Depends on:** [F1](../specs/F1-data-model.md) (schema: `inference_calls`, `quality_signals`, `budget_nodes`, catalog/pricing), [C1](../specs/C1-gateway-service.md) (hot-path ledger writes + `GatewayStore`), [C3](../specs/C3-budgets-metering.md) (ledger attribution + rollup + spend views), [C6](../specs/C6-quality-signals.md) (`quality_signals` contract), [O1](../modules/O1-ledger-audit.md) (shares the one ledger + retention policy)
**Enables:** [W1](../modules/W1-admin-portal.md) (Overview dashboards + spend rollups), [W2](../modules/W2-member-console.md) (spend chips + Activity), [O3](../modules/O3-device-fleet.md) (plane-split fleet views)
**Date:** 2026-07-23 · **Engine:** `sensei-*` crates @ `v0.4.6` · **Authoritative record:** [`../DECISIONS.md`](../DECISIONS.md) §3 (one authoritative ledger), §3b (quality signals)

---

> **Premise.** O2 turns the **one authoritative ledger** into the dashboards that justify the product: *cost down, work never stops*. It is a **pure read/aggregation layer** — it owns **no** hot-path write, no enforcement, and no second cost table. Everything O2 shows derives from the crate-native **`inference_calls`** ledger (`service_role`-write, the budget + audit source of truth) joined to **`quality_signals`** (C6) and the **catalog/pricing** + **budget tree** (C3). The retired `gateway_tasks` cost fields are never read. The load-bearing product claim — **local-vs-cloud savings** — is defined precisely here (§8) so a `$0` local call has a defensible, non-hand-wavy dollar figure behind "you saved $X".

---

## 1. Purpose & scope

Define the **analytics read model** for Strategos: the aggregations, the rollup strategy (precomputed vs on-the-fly), the cloud-equivalent-savings baseline, and the read contracts that back the Overview dashboard (W1), the member spend chips + Activity (W2), and the plane-split fleet views (O3). O2 answers "what did we spend, on what, where did it run, how much did local save us, how good were the answers, and where are we trending" — all from the single ledger + quality signals, tenant/RLS-scoped.

**In scope:** the aggregation catalog (cost trend, model mix, plane split / local-vs-cloud savings, fallback counts, latency percentiles, quality/grounding/judge/guardrail-hit rates, spend rollups per org→dept→team→user scope); the **precomputed rollup tables + materialized views** and their refresh strategy; the **savings baseline definition**; the read-only HTTP contracts on C1 that serve the dashboards; the RLS/capability posture for analytics reads.

**Out of scope:** writing the ledger (C1's `GatewayStore`); the quality-signal *contract* (C6 owns it — O2 consumes it); budget **enforcement**, reserve/commit, cascade, and the `budget_node_status` live view (C3 owns those — O2 reads spend *history*, C3 owns spend *authority*); audit immutability + SIEM streaming + CSV export of raw ledger/audit rows (O1 owns those — O2 exports *aggregates*); the model *pricing catalog* itself (F1/C3 catalog overrides own it — O2 reads it); device fleet health (O3 owns it — O2 supplies the plane-split numbers O3 renders).

---

## 2. Responsibilities

1. **Aggregate the ledger** — compute cost, call-count, token, latency, fallback, model-mix, and plane-split aggregations over `inference_calls`, grouped by the denormalized org→dept→team→user attribution columns (C3/GH-5) and by served model / provider / capability / plane / window.
2. **Compute cloud-equivalent savings** — for every `execution_location='local'` (`cost_usd = 0`) call, derive its **cloud-equivalent cost** from a defined baseline (§8) and roll it up as `savings_usd`; expose blended and per-scope savings.
3. **Blend quality with cost** — join `quality_signals` (C6) to produce grounding %, LLM-judge quality score, guardrail-hit rate, and redaction-hit rate alongside cost/latency, so "cost down" is never shown without "quality held".
4. **Maintain the rollup layer** — own the **precomputed rollup tables + materialized views** (per tenant × window × dimension) and their refresh cadence; fall back to on-the-fly aggregation for fine-grained / ad-hoc queries (§8 decision).
5. **Serve read contracts** — expose tenant/RLS-scoped, read-only HTTP endpoints (via C1 domain routes) that back the W1 Overview cards, W2 spend chips + Activity, and O3 plane-split views; publish a stable metric descriptor so TS clients don't hardcode metric keys.
6. **Trend + delta** — supply period-over-period deltas (e.g. "blended cost/call −35% · 14d") and trend series for the dashboard sparkbars.
7. **Export aggregates** — offer CSV/JSON export of *aggregated* analytics (not raw ledger rows — that is O1's SIEM/export surface).

**Non-responsibilities:** O2 never enforces, reserves, routes, redacts, embeds, judges, or writes the ledger/signals. It has **no** write path to `inference_calls`/`quality_signals`; it only writes its own derived rollup tables (via a `service_role` refresh job). If a number looks wrong, the fix is upstream (C1/C3/C6), never a compensating write in O2.

---

## 3. Data model (F1 tables owned / used)

O2 **owns** only its derived rollup artifacts (materialized views / rollup tables in the F1 schema, `service_role`-refreshed). It **reads** the authoritative sources; it adds **no** new source-of-truth table.

### 3.1 Read (owned elsewhere)

| Source | Owner | What O2 reads |
|---|---|---|
| `public.inference_calls` | C1 write / C3 attribution / F1 DDL (RW7, GH-5) | The single ledger. Columns O2 depends on: `tenant_id`, `id`, `created_at`, `served_model` (+ provider), `capability`, `input_tokens`/`output_tokens`, `cost_usd`, `execution_location` (`local\|cloud`), `budget_node_id` + denormalized `org_node_id`/`dept_node_id`/`team_node_id`/`user_node_id` (attribution, GH-5), fallback/attempt count + `why_model` trace ref, `compare_group_id`. **Read-only.** |
| `public.quality_signals` | C6 contract / F1 DDL | Grounding, judge-score, retrieval precision/recall, guardrail-hit, redaction-hit — keyed to `inference_call_id`/`message_id`. O2 reads via the C6-published `signal_key` taxonomy (§3.3 of C6), never hardcoding keys. **Read-only.** |
| `config.models` / `config.model_endpoints` / `config.model_capabilities` + per-tenant **catalog override / pricing** tables | F1 catalog / C3 overrides | `ModelPricing` (input/output $/token) for the **cloud-equivalent baseline** (§8) and for verifying `cost_usd`. The tenant's **capability→chain** binding + per-step `plane` (C2) to identify the *cloud model that would have served* a local call. **Read-only.** |
| `public.budget_nodes` | C3 | The org→dept→team→user tree (names, `kind`, `parent_id`) to label rollups and drive the scope selector. O2 reads the tree; **C3** owns `spent_amount`/headroom authority (`budget_node_status`). |
| `public.fallback_chains` / `fallback_chain_models` (+ `plane`) | C2 | To resolve the cloud-equivalent model for the savings baseline (§8) and to attribute fallbacks. **Read-only.** |

### 3.2 Owned — derived rollup layer (F1 schema, `service_role`-refresh)

Precomputed to keep dashboard reads cheap (DECISIONS §3b "rolled into analytics (O2)"; O2 seed "materialized views / rollup tables for cheap reads"). All are **derived, reconstructable** artifacts — dropping and rebuilding them from `inference_calls` + `quality_signals` loses nothing.

| Artifact | Grain | Contents |
|---|---|---|
| `analytics_usage_daily` (rollup table) | `(tenant_id, day, budget_node_id, served_model, provider, capability, execution_location)` | `calls`, `input_tokens`, `output_tokens`, `cost_usd` (sum of actual), `cloud_equiv_usd` (§8 baseline, computed for local rows; = `cost_usd` for cloud rows), `savings_usd` (`cloud_equiv_usd − cost_usd`, ≥0), `fallback_calls`, `latency_ms_sum`, `latency_ms_count`, `latency_ms_p95` (see §8 percentile note). |
| `analytics_quality_daily` (rollup table) | `(tenant_id, day, budget_node_id, served_model)` | `grounding_avg`, `judge_score_avg`, `retrieval_precision_avg`, `retrieval_recall_avg`, `guardrail_hit_calls`, `redaction_hit_calls`, `rated_calls`, `rating_avg`, `thumb_up`/`thumb_down`, `accept_calls`, `edit_calls`, `retry_calls` — averages weighted by call, counts for rates. |
| `analytics_model_mix_daily` (materialized view over `analytics_usage_daily`) | `(tenant_id, day, served_model, provider, execution_location)` | `calls`, `share_pct` (of tenant/day calls), `cost_usd`, `savings_usd`. Backs the "Most-used models" panel. |
| `analytics_overview_current` (materialized view) | `(tenant_id)` | The stat-row snapshot: `spend_today`, `spend_today_cap` (from C3 tree), `calls_today`, `fallbacks_today` (+ split outage vs budget), `latency_avg`/`latency_p95`, `blended_cost_per_call_14d` + prior-14d delta, `savings_14d`. Backs the W1 Overview stat cards + trend chips. |

**Refresh strategy (see §8 decision):** hot-window aggregates (today / current period) are **incrementally maintained** on ledger insert via a `service_role` trigger/`AFTER INSERT` fan-out into `analytics_usage_daily`/`analytics_quality_daily` (append-add, idempotent on `inference_call_id`); the materialized views (`analytics_model_mix_daily`, `analytics_overview_current`) refresh on a short schedule (default **60 s**, `REFRESH MATERIALIZED VIEW CONCURRENTLY`) and on-demand for the Overview load. Historical/ad-hoc ranges beyond the rollup grain (arbitrary date filters, per-user drill-down) are served **on-the-fly** directly against `inference_calls` under RLS. The rollup layer is **reconciled** against the immutable ledger (like C3 flow-10): a periodic job recomputes a day's rollup from the ledger and corrects drift, since `inference_calls` is the immutable truth and rollups are a cache.

---

## 4. Contracts

O2 has no UI of its own and no hot-path write. It exposes (a) read-only HTTP query endpoints (served by C1 domain routes, since analytics reads ride the authenticated gateway), (b) a published metric descriptor, and (c) an internal refresh job.

### 4.1 HTTP — analytics read model (C1-mounted, tenant/RLS-scoped, read-only)

All endpoints require an authenticated Supabase JWT (or API key) and are **tenant-scoped from the verified credential**, never the body. Scope narrowing to a `budget_node` subtree requires the reader to be within/above that node or hold an analytics-view capability (§5).

```
GET /v1/analytics/overview
  → 200 {                              # backs W1 Overview stat row + trend chips
      "spend_today":   { "value": 157.0, "cap": 1333.0, "unit": "usd", "pct_of_cap": 11.8 },
      "calls_today":   { "value": 3640, "delta_pct_vs_prev": 8.0 },
      "fallbacks_today": { "value": 47, "breakdown": { "outage": 3, "budget": 44 } },
      "latency":       { "avg_ms": 1300, "p95_ms": 2600 },
      "blended_cost_per_call": { "value": 0.043, "unit": "usd", "window_days": 14, "delta_pct": -35.0 },
      "savings_14d":   { "value": 812.40, "unit": "usd", "vs_baseline": "cheapest_cloud_in_chain" }
    }
```

```
GET /v1/analytics/cost-trend?window=14d&bucket=day&scope_node_id=…
  → 200 { "series": [ { "day": "2026-07-10", "blended_cost_per_call": 0.061,
                        "cost_usd": 214.2, "calls": 3510, "savings_usd": 48.1 }, … ],
          "delta_pct": -35.0 }
```

```
GET /v1/analytics/model-mix?window=7d&scope_node_id=…
  → 200 { "models": [ { "model": "sonnet-4.6", "provider": "anthropic",
                        "execution_location": "cloud", "calls": 1900, "share_pct": 52,
                        "cost_usd": 402.1, "savings_usd": 0 },
                      { "model": "gemma-4-9b", "provider": "local",
                        "execution_location": "local", "calls": 510, "share_pct": 14,
                        "cost_usd": 0, "savings_usd": 61.3 }, … ] }
```

```
GET /v1/analytics/plane-split?window=30d&scope_node_id=…
  → 200 {                              # local-vs-cloud savings — the headline claim
      "local":  { "calls": 5120, "cost_usd": 0,     "cloud_equiv_usd": 940.7 },
      "cloud":  { "calls": 8830, "cost_usd": 1774.0, "cloud_equiv_usd": 1774.0 },
      "savings_usd": 940.7,
      "savings_pct": 34.6,             # savings / (cost_usd_total + savings_usd)
      "baseline": "cheapest_cloud_in_chain",
      "series": [ { "day": "…", "local_calls": …, "cloud_calls": …, "savings_usd": … }, … ]
    }
```

```
GET /v1/analytics/spend?window=…&group_by=org|dept|team|user|model|provider|capability&scope_node_id=…
  → 200 { "rows": [ { "node_id": "…", "node_name": "Payments", "kind": "team",
                      "cost_usd": 312.4, "calls": 1210, "savings_usd": 88.0,
                      "cap_usd": 500.0, "pct_of_cap": 62.5 }, … ] }
  # group_by=user|team|… uses the denormalized attribution columns → no recursive join.
```

```
GET /v1/analytics/quality?window=…&scope_node_id=…&group_by=model|node
  → 200 { "rows": [ { "model": "sonnet-4.6", "grounding_avg": 86.0,
                      "judge_score_avg": 91.0, "guardrail_hit_rate": 0.4,
                      "redaction_hit_rate": 1.2, "rating_avg": 4.3,
                      "accept_rate": 0.88, "calls": 1900 }, … ] }
```

```
GET /v1/analytics/export?report=cost-trend|model-mix|plane-split|spend|quality&window=…&format=csv|json
  → 200 (text/csv | application/json)  # AGGREGATED analytics only; raw-row/SIEM export is O1.
```

Error surface: `403 { error: "capability_required", capability: "analytics.read" }` when a reader requests a scope beyond their permitted subtree without the capability; `400` on bad `window`/`group_by`/`bucket`; `422` on an unknown metric key.

### 4.2 Metric descriptor (published, versioned)

O2 publishes `analytics-metrics.v1.json` (mirroring C6's `quality-signals.v1.json` pattern) enumerating every metric key, unit (`usd`/`ms`/`percent`/`ratio`/`count`), dimension, and its source (ledger vs quality-signal vs derived). W1/W2/O3 TS clients render from the descriptor so metric keys/units are never hardcoded. Adding a metric bumps `schema_version` additively.

### 4.3 Internal — refresh job (`service_role`)

```
-- Incremental (on inference_calls insert; idempotent on inference_call_id)
analytics_rollup_apply(p_tenant uuid, p_call_id uuid) returns void  -- AFTER INSERT trigger fan-out

-- Scheduled (default 60s) + on-demand
REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_model_mix_daily;
REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_overview_current;

-- Reconcile (periodic; ledger is immutable truth)
analytics_rollup_reconcile(p_tenant uuid, p_day date) returns void  -- recompute day from ledger, correct drift
```

The savings baseline (§8) is computed inside `analytics_rollup_apply` at rollup time so `cloud_equiv_usd`/`savings_usd` are stored, not recomputed per read (pricing is snapshotted at call time — see §8).

### 4.4 Events

O2 emits **no** domain events on the hot path. Rollup reconciliation drift beyond a tolerance emits an `analytics.reconciled` audit row (to O1) mirroring C3 flow-10, so a corrected number is itself auditable. Budget-alert events are C3's, not O2's.

---

## 5. Security & RLS

- **Read-only, no privileged write.** O2 has **no** client-facing write. It reads `inference_calls`/`quality_signals`/catalog/`budget_nodes` under RLS and writes **only** its own derived rollup tables via the `service_role` refresh job. `authenticated`/`anon` have `INSERT`/`UPDATE`/`DELETE` **REVOKED** on all `analytics_*` rollup tables (they are `service_role`-refresh only, tenant-scoped `SELECT`).
- **Tenant isolation.** Every rollup table carries `tenant_id`; RLS predicate `tenant_id = (auth.jwt()->>'tenant_id')::uuid`. The analytics HTTP endpoints take tenant from the **verified credential** (never the body), and the `PgGatewayStore { tenant_id }` scopes every underlying read. Cross-tenant read returns **0 rows** (extends the F1 RW12 negative-test harness to `analytics_*` + the analytics endpoints).
- **Scope authz (capabilities, F2-owned canonical list).** A member sees analytics for **their own** subtree (their leaf `budget_node` + descendants they own) without a special capability. Viewing **tenant-wide** or another subtree's spend/quality requires the F2-owned **`analytics.read`** capability (admin/Overview screen, W1), resolved server-side from `role_permissions` via the JWT `role_ids` — the JWT carries no raw analytics grant. O2 mints **no new capability**; it references F2's set (analytics/audit gating shared with O1). A member without `analytics.read` requesting a `scope_node_id` outside their subtree is `403`d.
- **Secrets & redaction (W5).** O2 aggregates **metadata only** — token counts, cost, model names, node ids, latency, and W5-clean signal *counts/labels* from `quality_signals`. It reads **no** prompt/response content and **no** `router_credentials`, so there is no secret/PII surface to redact. Because `quality_signals.value_json` is already guaranteed W5-clean by C6 (counts/placeholders only), rollups inherit that guarantee — a redaction-hit *rate* is safe to chart; the redacted material is never present.
- **Device-status on the hot path.** Analytics reads ride the C1 hot path where the per-request device-status check applies (a revoked device with a live JWT cannot keep pulling dashboards), consistent with DECISIONS §2 apply-without-asking.
- **Ledger as immutable truth.** O2 never mutates `inference_calls`; a wrong figure is corrected by fixing the upstream write and re-running `analytics_rollup_reconcile`, never by editing the ledger. Rollups are a cache reconciled against the immutable ledger.
- **Immutability of exports.** `/v1/analytics/export` returns aggregates derived at request time; it is not the audit-of-record (that is O1's immutable ledger export). No PII/secret leaves via export because only aggregates are exported.

---

## 6. Key flows (numbered)

1. **Rollup on a completed call (v1).** C1's `GatewayStore` writes an `inference_calls` row (cost, served model, `execution_location`, node attribution, fallback/why-model trace) + C6 writes the `quality_signals` batch → the `AFTER INSERT` trigger fans out `analytics_rollup_apply(tenant, call_id)` → the day/node/model/plane bucket in `analytics_usage_daily` is incremented (calls, tokens, `cost_usd`, `latency`, `fallback_calls`), the **cloud-equivalent baseline** is computed (§8) and `cloud_equiv_usd`/`savings_usd` accrued, and the matching `analytics_quality_daily` bucket updates grounding/judge/rate aggregates. Idempotent on `inference_call_id` (a replayed reconcile does not double-count).
2. **Overview dashboard load (W1).** W1 calls `GET /v1/analytics/overview` → served from `analytics_overview_current` (materialized, ≤60 s stale) → renders the stat row (Spend today / Calls served / Fallbacks / Avg latency p95), the "Blended cost / call · 14d" trend + `−35%` delta chip, and the **local-vs-cloud savings** figure. "Most-used models" reads `GET /v1/analytics/model-mix`.
3. **Local-vs-cloud savings (the headline claim).** For each `execution_location='local'` call (`cost_usd=0`), O2 resolves the **cloud-equivalent model** — the cheapest cloud step in the same capability chain that would have served had budget/plane routed to cloud (§8) — prices the call's actual token counts at that model's snapshotted `ModelPricing`, and accrues `cloud_equiv_usd`. `GET /v1/analytics/plane-split` returns `savings_usd = Σ cloud_equiv_usd(local)` and `savings_pct`, with the baseline label surfaced so the number is explainable, not magic.
4. **Cost + quality blended trend.** `GET /v1/analytics/cost-trend` returns blended cost/call per bucket; the W1/W3 trend panel overlays `analytics_quality_daily` grounding/judge series so a cost drop is shown *with* quality held (guards against "we got cheaper by getting worse").
5. **Scope drill-down (spend by org→dept→team→user).** W1 selects a `budget_node` → `GET /v1/analytics/spend?group_by=team&scope_node_id=…` → grouped from the denormalized attribution columns (no recursive join, per C3/GH-5) → renders spend + savings + `pct_of_cap` per node. A member without `analytics.read` is confined to their own subtree.
6. **Member spend chips + Activity (W2).** W2 reads `GET /v1/analytics/spend?scope_node_id=<own leaf>` for the spend chip and `GET /v1/analytics/model-mix` / `cost-trend` for the Activity panel; execution-location + fallback columns come from the ledger attribution O2 exposes. (Live *remaining-budget* is C3's `budget_node_status`; O2 supplies spend *history/trend*.)
7. **Plane-split fleet view (O3).** O3 Device fleet reads `GET /v1/analytics/plane-split` (+ per-device grouping where the ledger carries device attribution) to show how much local execution the fleet contributed and the savings it produced.
8. **Reconciliation.** A periodic `analytics_rollup_reconcile(tenant, day)` recomputes a day's `analytics_usage_daily`/`analytics_quality_daily` from the immutable ledger; drift beyond tolerance corrects the rollup and emits an `analytics.reconciled` audit row (O1). This catches out-of-band ledger inserts (e.g. C3 device-usage reconciliation, flow-7 of C3) and pricing back-fills.
9. **Aggregate export.** An admin with `analytics.read` calls `/v1/analytics/export?report=plane-split&format=csv` → O2 streams the aggregated rollup as CSV. Raw per-call rows / SIEM streaming remain O1's surface.

---

## 7. Gateway-crate dependencies (+ GH-issue refs)

Engine = the six `sensei-*` crates @ **`v0.4.6`**. O2 is a **pure consumer** — it does not touch `execute`/`execute_stream` or the crate at all directly; it reads the SQL artifacts C1/C3/C6 persist. No **new** gateway-repo issue is required by O2. Dependencies it rides:

- **GH-5 — `inference_calls` ledger shape (blocking).** O2's per-scope spend/savings grouping depends on the denormalized org→dept→team→user attribution columns + rollup-friendly shape (GH-5, extends `GatewayStore::InferenceCall`; `subject_id := budget_node_id`). Until GH-5 lands, `GET /v1/analytics/spend?group_by=team|user` cannot group without recursive joins. Sequenced before F1-rework/C3 (already filed for C3); O2 rides it.
- **GH-1 — per-step `plane` + execution-location on the trace (blocking for the headline claim).** `execution_location` on `inference_calls` (and the per-step plane on the trace) is what distinguishes local ($0) from cloud calls — the entire local-vs-cloud savings computation depends on it. Until GH-1 lands, plane-split degrades to "unknown plane" and savings cannot be attributed. Filed for C2/D3; O2 rides that release.
- **GH-4 — reserve→commit (consumer-side, resolved).** O2 reads the *committed actual* `cost_usd` C3 writes; it does not depend on the reserve mechanism itself. No action.
- **Crate reuse (read-only):** `ModelPricing` (`$/input-token`, `$/output-token`) from the catalog and `Cost::from_usage` semantics are the basis for the cloud-equivalent baseline (§8) — O2 reuses the same pricing shape C3 meters with, so a local call's cloud-equivalent is priced identically to how a real cloud call would have been. `get_spend_since`/`get_spend_by_model_since`/`get_usage_since` (subject/node rollup, GH-5) are available as convenience readers, but O2's dashboards use the precomputed rollups for cheap reads.

---

## 8. Decisions resolved

Settled per DECISIONS DEFAULTS + the O2/O1 seeds' open questions, with rationale.

- **Cloud-equivalent savings baseline = "cheapest cloud step in the same capability chain, priced on the call's actual tokens, at call-time pricing."** *Resolves the O2-seed open question ("how local ($0) calls factor into savings").* For a `local` call, O2 identifies the capability chain that served it and picks the **cheapest cloud (`plane='cloud'`) model bound in that chain** as the counterfactual — i.e. the cheapest cloud model the router *would* have fallen through to had the local plane been unavailable — and prices the call's **actual** `input_tokens`/`output_tokens` at that model's `ModelPricing`. *Rationale:* (a) it is defensible and conservative — savings are measured against the *cheapest* realistic cloud alternative, not the most expensive, so the claim never overstates; (b) it uses the tenant's own chain config, so it reflects what they'd actually have paid; (c) it reuses the exact `ModelPricing` shape C3 meters with, so local and cloud dollars are commensurable. **Edge cases:** if a chain has **no** cloud step (local-only chain), `cloud_equiv_usd = 0` and the call is reported as "local-only, no cloud counterfactual" (excluded from savings, shown as a separate "local-only calls" count) — inventing a phantom cloud price would be dishonest. If pricing is missing for the chosen cloud model, the call is flagged `savings_unpriced` and excluded from the savings total (surfaced as a data-quality count), never guessed.
- **Pricing is snapshotted at call time, not recomputed at read time.** `cloud_equiv_usd`/`savings_usd` are computed in `analytics_rollup_apply` using the pricing in effect when the call ran and stored on the rollup row. *Rationale:* pricing catalog overrides change; a savings figure must be reproducible and must not silently shift when an admin edits a price later. Historical accuracy > live re-pricing. (A pricing back-fill triggers `analytics_rollup_reconcile` for the affected window.)
- **Precomputed rollups for the dashboard hot path; on-the-fly for ad-hoc.** *Resolves the O2-seed open question ("precomputed rollups vs on-the-fly").* Overview/model-mix/plane-split/cost-trend at day-or-coarser grain and current-period stats are served from `analytics_*` rollups (incremental on insert + short materialized-view refresh); arbitrary date ranges, per-user drill-downs, and filters finer than the rollup grain run **on-the-fly** against `inference_calls` under RLS. *Rationale:* the dashboards are the high-frequency reads and must be cheap; ad-hoc/forensic queries are rare and tolerate a direct scan. One ledger, two read paths — never a second cost table (DECISIONS §3).
- **O2 reads the one ledger; it never creates a parallel cost store.** All aggregates derive from `inference_calls` (+ `quality_signals`); the retired `gateway_tasks` cost fields are never read. *Rationale:* DECISIONS §3 "one authoritative ledger" — a second cost table would drift from budget truth. Rollup tables are explicitly a *reconstructable cache*, reconciled against the ledger (flow 8).
- **Local calls count for usage/quota but contribute `cost_usd = 0` to spend and `savings_usd > 0` to savings.** *Rationale:* consistent with C3 (local calls are metered at `cost_usd=0` but tokens counted); "savings" is the *avoided* cloud spend, reported separately from actual spend so the two are never conflated. The Overview shows both "spend today" (actual) and "savings" (avoided).
- **Latency percentiles (p95) computed from the ledger, approximated in rollups.** The rollup stores `latency_ms_sum`/`count` for exact averages and a per-bucket p95 via a bounded histogram / `percentile_cont` over the day's rows at reconcile time; the on-the-fly path computes exact `percentile_cont(0.95)` for arbitrary windows. *Rationale:* exact streaming percentiles are not incrementally maintainable cheaply; a per-day p95 refreshed at reconcile plus on-the-fly exactness for ad-hoc ranges is the pragmatic split.
- **Analytics reads are gateway-mounted (C1 routes), not direct PostgREST.** *Rationale:* consistent with the split-plane posture — reads ride the authenticated hot path (device-status check, capability resolution) and the `PgGatewayStore` tenant scoping; it also lets O2 serve computed metrics (savings, blended cost, deltas) that are not raw table columns. Simple tenant-scoped `SELECT` on the rollup tables remains available via PostgREST under RLS for trivial widgets.
- **`analytics.read` capability gates cross-subtree/tenant-wide analytics; own-subtree needs none.** *Rationale:* DECISIONS RBAC default — capabilities resolved server-side; a member seeing their own spend is a benign self-scoped read, tenant-wide cost visibility is an admin concern. O2 mints no new capability, references F2's canonical set (shared with O1).
- **No external billing/invoicing in O2 (v1).** Mirrors C3 §10 — external invoicing (Stripe) is **not ratified**; O2 shows internal metered spend + savings. Emitting usage to a billing provider is a later product call, not an O2 build blocker.

---

## 9. Acceptance criteria (observable, testable)

1. **One-ledger sourcing.** Every O2 number reconciles to `SELECT … FROM inference_calls` for the same window/scope; no O2 endpoint reads `gateway_tasks`. A test that zeroes the rollup tables and re-runs `analytics_rollup_reconcile` reproduces identical figures from the ledger alone.
2. **Rollup on insert.** Inserting an `inference_calls` row (cloud, cost `$0.0041`, node attribution) makes it appear in `analytics_usage_daily` for the right `(tenant, day, node, model, plane)` bucket with `cost_usd` incremented; a replayed reconcile does **not** double-count (idempotent on `inference_call_id`).
3. **Local-vs-cloud savings is defined + non-zero + explainable.** A `local` call (`cost_usd=0`) on a chain with a cloud step produces `cloud_equiv_usd > 0` priced at the cheapest cloud step's `ModelPricing` on the call's actual tokens; `GET /v1/analytics/plane-split` returns `savings_usd = Σ cloud_equiv_usd(local)` and a `baseline` label. A local-only-chain call reports `savings_usd = 0` and is counted separately (not inflated).
4. **Savings never overstates.** For a fixed ledger, `savings_usd` computed against the cheapest cloud step is ≤ the figure against any other cloud step in the chain (baseline is the conservative floor); a call with unpriced counterfactual is excluded and surfaced as `savings_unpriced`, not guessed.
5. **Overview stat row.** `GET /v1/analytics/overview` returns spend-today (+ cap + pct), calls-today (+ delta), fallbacks (outage/budget split), latency avg + p95, blended cost/call 14d + delta, and savings — matching the W1 Overview mockup fields, served from `analytics_overview_current` (≤60 s stale).
6. **Model mix + share.** `GET /v1/analytics/model-mix` returns per-model calls + `share_pct` summing to ~100% for the window, tagged by provider + `execution_location`, matching the "Most-used models" panel.
7. **Scope drill-down without recursion.** `GET /v1/analytics/spend?group_by=team` groups by the denormalized attribution columns (verified by query plan: no recursive CTE), and each node's `cost_usd` equals the ledger sum for that subtree.
8. **Quality blended with cost.** `GET /v1/analytics/quality` returns grounding/judge/guardrail-hit/redaction-hit/rating aggregates from `quality_signals`; disabling C6 capture makes these panels empty (proving the dependency), while cost panels still populate from the ledger.
9. **Tenant isolation + scope authz.** A tenant-A reader gets 0 rows for tenant B on every endpoint and every rollup table (RW12 extended); a member without `analytics.read` requesting a `scope_node_id` outside their subtree is `403`d; own-subtree reads succeed without the capability.
10. **No write / no secret surface.** O2 exposes no client write to `inference_calls`/`quality_signals`; `authenticated` cannot write `analytics_*` tables (PostgREST INSERT denied); no endpoint returns prompt/response content or credential material — only aggregated metadata + W5-clean signal counts.
11. **Reconciliation corrects drift.** Injecting an out-of-band `inference_calls` row (e.g. a device-reconciled local call) and running `analytics_rollup_reconcile` corrects the affected day's rollup and emits an `analytics.reconciled` audit row (O1).
12. **Descriptor-driven client.** A client rendering from `analytics-metrics.v1.json` shows all metrics with correct units without hardcoding keys; adding a metric bumps `schema_version` without breaking existing dashboards.
13. **Aggregate export only.** `/v1/analytics/export` returns aggregated CSV/JSON; there is no O2 path to export raw per-call rows (that is O1), verified by contract test.

---

## 10. Open questions (genuine)

- **Savings baseline for BYOK/discounted cloud pricing.** The §8 baseline prices the counterfactual at the tenant's catalog `ModelPricing`. If a tenant has negotiated/BYOK provider discounts not reflected in the catalog, the savings figure uses list pricing and may overstate the *real* avoided spend. Whether to model per-tenant effective cloud pricing (vs. accept list-price counterfactual with a disclosure label) is a product-honesty call, deferred pending a tenant that needs it. *(Extends the O2-seed savings question.)*
- **Session-only Playground experiment counting.** How W3 session-only experiment runs surface in analytics — counted/metered as real `inference_calls` vs. flagged ephemeral and excluded from cost/savings/mix rollups. Depends on C6's parallel open question (§10 of C6) and the ephemeral-signal retention flag; affects whether experiment traffic inflates the dashboards. *(Carried from C6/W3.)*
- **Rollup grain + retention for long-horizon trends.** The rollups are day-grained; multi-quarter trend panels may need month-grained secondary rollups and a policy for how long raw daily rollups persist after the ledger rows age out under O1's per-artifact retention (O1 open question). Which coarser grains to precompute and their retention is deferred until dashboard requirements past 90 days are set. *(Ties to the O1 retention-window open question.)*
- **Latency percentile fidelity in rollups.** §8 approximates per-day p95 at reconcile and computes exact percentiles on-the-fly. If admins need exact p95/p99 on precomputed dashboards over long windows, a t-digest/`tdigest` extension or histogram-per-bucket may be warranted — deferred pending a measured need.
