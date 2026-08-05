# §D Phase 6 — metering domain relocation (build plan)

**Scope (ratified by Jerry 2026-08-05): MECHANICAL MOVE ONLY.** Relocate the metering/analytics
domain `public` → `metering` (columns unchanged), no crate change, no crate release. **Defers** to
focused follow-ons: FK-normalize (adapter/model→catalog FKs), `*_node_id`→`org_unit_id` fold + P12
reversal, `cost_usd`→`cost_estimated`/`cost_actual`, `routing_attempts`/`feedback`/`quality_signals`
split, retire legacy `sessions`/`gateway_tasks`. Resumes after Phase 5 (`493fd3c`, pushed).

## 1. Key design call — DIRECT REPOINT, not shield-first

A schema move with **no column reshape** needs no net-new shield: a shield's value is decoupling a
*reshape*, and the analytics reads have no clean projection to shield (the aggregation lives in the
gateway query, per-endpoint). So P6 = relocate the DB objects + repoint the ~20 gateway refs directly.
The 6 design shields (`requests_ledger_for_tenant`, `request_trace_detail`, `overview_dashboard_for_tenant`,
`plane_split_for_tenant`, `model_mix_for_tenant`, `cost_trend_for_tenant`) land with the **FK-normalize**
phase, where they absorb the reshape + fold the client fan-in. (Deviation from the literal "shield-first"
wording in the scope question — rationale: YAGNI + simplest-design-that-passes-tests.)

Consequence: the DB move + gateway repoint are **one coordinated change** (un-shielded → they must land
together, like P5 S3–S5).

## 2. Objects moved (5 tables + 2 MVs + 6 functions)

| current (`public`) | target (`metering`) | change |
|---|---|---|
| `inference_calls` | `metering.inference_calls` | schema only |
| `execution_traces` | `metering.execution_traces` | schema only |
| `analytics_usage_daily` | `metering.usage_daily` | schema + **rename** |
| `analytics_quality_daily` | `metering.quality_daily` | schema + rename |
| `analytics_applied_calls` | `metering.applied_calls` | schema + rename |
| `analytics_model_mix_daily` (MV) | `metering.model_mix_daily` | schema + rename |
| `analytics_overview_current` (MV) | `metering.overview_current` | schema + rename |
| `analytics_rollup_apply` (fn) | `metering.rollup_apply` | schema + rename |
| `analytics_fanout` (fn) | `metering.fanout` | schema + rename |
| `analytics_cloud_equiv` (fn) | `metering.cloud_equiv` | schema + rename **(called from gateway — CE_LATERAL)** |
| `analytics_refresh_mviews` (fn) | `metering.refresh_mviews` | schema + rename |
| `analytics_rollup_reconcile` (fn) | `metering.rollup_reconcile` | schema + rename |
| `rollup_usage_daily` (fn) | `metering.rollup_usage_daily` | schema only |

**FK/dep notes:** `inference_calls.session_id` FK→`public.sessions` (sessions stays in public this phase —
legacy retirement deferred; the cross-schema FK metering→public is fine). The 6 rollup functions all set
`search_path = public, core, extensions` and use `public.analytics_*` internally → repoint their bodies
to `metering.*`. Triggers on `inference_calls`/`quality_signals` that call `rollup_apply`/`fanout` must be
re-pointed. MVs have no `CREATE OR REPLACE` → drop+recreate in the live txn.

## 3. Gateway blast radius (3 files, 20 refs — from explorer)

- **store.rs** — `insert_inference_call` INSERT (`:107`), `get_inference_calls_by_session` (`:165`),
  `get_spend_since` (`:187`), `get_spend_by_model_since` (`:221`); `insert_execution_trace` (`:251`),
  `get_execution_trace` (`:273`), `get_traces_by_call` (`:296`). Keep `$14::metering.call_status` (already metering).
- **routes/ledger.rs** — `/v1/requests` inline SQL (`:128`, `public.inference_calls`; 13-col json_agg contract).
- **routes/analytics.rs** — `usage_daily`×5 (`:208,:252,:259,:299,:538`), `quality_daily`×1 (`:480`),
  `cloud_equiv` CE_LATERAL const (`:158`, used by plane_split_sql/spend_sql), `inference_calls`×3
  (`:330,:394,:529`) + 2 test sites (`:764,:828`). `$4::core.execution_location` cast in test (`:768`) unchanged.
- **chat.rs/judge.rs** — write call-sites only (`chat.rs:536,543,758,762,1063,1066`; `judge.rs:229`); no SQL, no change.

## 4. Policies + tests touched

- **policies/analytics.sql** — rollup-table RLS (`analytics_usage_daily`/`quality_daily` → `metering.usage_daily`/`quality_daily`) + MV/marker revokes (rename the 3). 
- **policies/rework.sql** — the `analytics_usage_daily`/`quality_daily` privileged rows → metering names.
- **policies/tenant_isolation.sql** — `('public','inference_calls')`/`('public','execution_traces')` → `('metering', …)`.
- **policies/grants.sql** — same two ledger rows → metering; the `usage metering` grant comment already anticipates it.
- **tests** — `analytics.sql` (heavy: rollup + MV + savings), `authz.sql` (analytics grain inserts), `enums.sql`
  (`call_status` on inference_calls — already `metering.call_status`; table ref → metering), `rls.sql` (coverage
  already scans... **NB: metering is NOT in rls.sql's nspname set** — must add `metering`).

## 5. ⚠️ rls.sql coverage gap

`tests/rls.sql` coverage scan currently lists `core, public, audit, device, catalog, keyvault, governance`
— **`metering` is absent**. Moving tenant tables (inference_calls, execution_traces, usage_daily,
quality_daily, applied_calls) into `metering` means they'd escape the coverage assertion. **Add `metering`
to the nspname set** (and keep `applied_calls` in the deny-all exception list like it is now for
`analytics_applied_calls`). This is the security-critical discipline (coverage-nspname) from prior phases.

## 6. Slice plan

- **P6-1 — enum/schema prep:** ensure `metering` schema usage grants (already granted in grants.sql:14);
  add `metering` to rls.sql coverage nspname. TDD: rls.sql green pre-move.
- **P6-2 — the move (one coordinated change):** live ALTER txn on 55322 (SET SCHEMA + RENAME ×13 objects;
  drop+recreate the 2 MVs + repoint the 6 fn bodies + triggers) + DDL files to match (git mv + rewrite
  headers/search_path/internal refs) + policies (4 files) + tests (analytics/authz/enums/rls) + gateway
  repoint (3 files). moves.sql M-meter-* guard. Verify: full DB suite (esp. analytics.sql rollup +
  savings), gateway build, live rollup smoke, dbd-pattern-verifier gate.

## 7. Verification gates

- Full DB suite green — **analytics.sql** (rollup_apply idempotency + savings baseline + MV reconstruct) is
  the load-bearing one; RLS coverage now includes `metering`.
- Gateway builds + the analytics/ledger DB-backed tests pass (P12 gate, /v1/requests read).
- Live smoke: insert a call → `metering.rollup_apply` → `metering.usage_daily` accrues → MV refresh.
- dbd-pattern-verifier CONFORMANT (matview under correct folder, deny-all MVs, idempotent DDL, RLS coverage).
- **Prod cutover** = the live ALTER txn at merge time (deferred; dev proves the end-state).
