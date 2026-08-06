# §D Ledger Normalize (LN) — build plan

**Scope RATIFIED by Jerry 2026-08-05: FULL §110–114 including `cost_estimated`** (the one crate-coupled
piece → a **`make bump` crate release**). Pacing: **scope now, build FRESH** (biggest + most
security-sensitive slice yet — the cost ledger). Resumes after §D Phase 6 (`499687a`, pushed). This is
the deferred "ledger overhaul" from the P6 mechanical move. Topic memory: `project-db-phase6-metering.md`
(deferred list) + this doc.

> ⚠️ FIRST STEP in the fresh session: re-ground (state will have evolved). Re-run the P6-style gateway
> explorer over `metering.inference_calls` read/write sites + read design db-redesign.md §108–120 +
> db-access-layer.md §140–163 (shields) + the crate `InferenceCall` (below). Don't trust these line
> numbers blind — verify.

## 1. The crate coupling (the load-bearing constraint)

Shared crate `InferenceCall` lives at **`~/Developer/gateway/crates/gateway/src/store.rs:25`**
(consumed by torii via `[patch]`). Current fields: `id, session_id, project_id, capability,
chain_id: Option<String>, adapter: String, model: String, api_model_id, input_tokens, output_tokens,
cost_usd: f64, duration_ms, status, error_type, fallback_sequence, recorded_at, subject_id, tier`.

- **NO crate change** (torii `store.rs` resolves at write, shields resolve back): FK-normalize
  (adapter/model/chain_id → catalog ids), `*_node_id`→`org_unit_id`, `cost_usd`→`cost_actual`,
  routing_attempts, quality_signals split, feedback.
- **CRATE CHANGE (make bump)**: **`cost_estimated`** — the reserve estimate (computed in torii
  `budgets::estimate`, `chat.rs`) is NOT on `InferenceCall`. Threading it through the store write needs
  a new field on `InferenceCall` (or a new store-trait param). → edit the crate, `make bump` (lockstep
  both crates + cargo clean), merge crate to main, bump the torii `[patch]`/pin. Per
  [[feedback_gateway_release_flow]]. **Do the crate change in its OWN slice, late, so one release covers it.**

## 2. Target `metering.inference_calls` shape (§110)

DROP (free-text + denorm): `adapter`, `model`, `chain_id`, `org_node_id`/`dept_node_id`/`team_node_id`/
`user_node_id`, `budget_node_id`. Keep/ADD:
- `model_id`/`router_id`/`capability_id`/`endpoint_id` **FK→catalog** (replace free-text; store.rs
  resolves the winning adapter/model/router/capability → ids at write; endpoint_id = the (model,router,
  capability) `model_endpoints` row actually used).
- `org_unit_id` **FK→core.org_units** (the cap-bearing unit; replaces the 5 `*_node_id` snapshot cols —
  attribution walks the org tree). `hold_id` **FK→governance.holds** (already a bare uuid today → add FK).
- `conversation_id` **→content** (replaces session_id/project_id once content lands; may stay nullable/deferred if content isn't ready — see §6).
- `cost_estimated` + `cost_actual` `numeric(14,6)` — BOTH snapshotted at call time vs the then-current
  `model_endpoints` price (never recomputed). `cost_actual` = today's `cost_usd`; `cost_estimated` = the
  reserve estimate (crate-coupled).
- `status metering.call_status`, `execution_location`, `recorded_at`. No prompt/response bodies.

## 3. New tables + splits (§112–114)

- **`metering.routing_attempts`** (NEW): pk(tenant_id,id), inference_call_id FK, attempt_no, router_id,
  model_id, `plane execution_location`, latency_ms, outcome, cost_usd. Normalizes `execution_traces.trace`
  jsonb (attempts[]) into rows for the Compare/Requests trace UI. Populate at write (store.rs from the
  trace) or via a function. Backs `request_trace_detail`.
- **`metering.quality_signals`** (SPLIT, §7-#6): replace the polymorphic `subject_id` + fragile
  `source LIKE 'c5.%'` with `subject_type metering.signal_subject {call,message,conversation}` + per-target
  nullable FKs (call_id/message_id/conversation_id) + CHECK exactly-one-set; `signal_class {implicit,system}`,
  signal_key, value_num/text/json, schema_version. service_role-write. (NEW enums: signal_subject; signal_class exists.)
- **`metering.feedback`** (NEW, §7-#4): user-written explicit signals split OUT of quality_signals.
  pk(tenant_id,id), subject FKs (as above), actor_id→profiles, kind (thumb_up/down/rating/edit/accept),
  value. **owner-INSERT policy** (`with check profile_id = auth.uid()`) — the interaction loop must write.
  Rollups union both quality_signals + feedback.

## 4. The 6 shields (db-access-layer §140–163) — SHIELD-FIRST here (unlike P6)

Now there IS a reshape to decouple, so ship shields FIRST (they absorb the FK-normalize + cost rename +
node-id fold, keeping the read contracts byte-identical), THEN reshape:
- **`requests_ledger_for_tenant`** ★ — `RequestRow{id,chain_id,adapter,model,execution_location,
  input/output_tokens,cost_usd(←cost_actual),duration_ms,status,fallback_sequence,recorded_at}`. Resolves
  the catalog FKs back to adapter/model names. Backs `/v1/requests`.
- **`request_trace_detail`** — `RoutingTrace{request_id,capability,status,duration_ms,attempts[...]}` from
  routing_attempts. Backs `/v1/requests/{id}/trace`.
- **`overview_dashboard_for_tenant`**, **`plane_split_for_tenant`**, **`model_mix_for_tenant`**,
  **`cost_trend_for_tenant`** — fold the client fan-in; MV-backed ones are service_role-mediated + in-query
  tenant filter (MVs can't carry RLS). Back the `/v1/analytics/*` endpoints.

## 5. The P12 reversal (analytics)

`*_node_id`→`org_unit_id` DROPS the denormalized spend GROUP BY columns → the spend/model-mix per-tier
group-bys must **walk the org tree** (recursive) instead of grouping by the denorm column. This
**reverses the P12 no-recursive-CTE gate** (a deliberate design change, db-access-layer §78). The rollup
tables (`metering.usage_daily`/`quality_daily`) are keyed by `budget_node_id` + `served_model` — after the
fold these become `org_unit_id` + `model_id` (grain change → the rollup functions rollup_apply/reconcile/
rollup_usage_daily + the MVs must be reworked, and the daily rollup is rebuildable so no data migration).
The P12 gate TEST (`p12_gate_spend_no_recursion`) must be RE-SPEC'd (the invariant it guards is intentionally retired).

## 6. Open sub-decisions (resolve at build-start)

1. **Legacy retirement (§115: sessions/session_logs/gateway_tasks/gateway_task_logs) — IN or DEFER?**
   inference_calls.session_id→sessions; retiring sessions means session_id→`conversation_id` (content
   domain, currently public). This couples to the **content phase (P7)**. RECOMMEND: DEFER legacy retire +
   conversation_id to P7; keep session_id nullable/no-FK in LN. Confirm with Jerry.
2. **endpoint_id resolution** — the winning `model_endpoints` row must be identifiable at write from
   (model_id, router_id, capability_id). Confirm the gateway knows all three at store time (it does — the
   chain step that won). May need `is_default`/priority tiebreak (like chains_for_tenant).
3. **cost_estimated source** — thread `budgets::estimate` result → `InferenceCall.cost_estimated` (crate)
   OR a new store param. Decide the crate API shape.
4. **conversation_id** — add now (nullable, no FK until content) or defer entirely to P7.

## 7. Slice order (shield-first; crate change LAST + isolated)

- **LN-1 — shields over CURRENT schema:** ship the 6 shields reading today's `metering.inference_calls`
  (byte-identical contracts), repoint `/v1/requests`, `/v1/requests/{id}/trace`, `/v1/analytics/*` to them.
  (routing_attempts not built yet → request_trace_detail reads execution_traces.trace as today, shielded.)
- **LN-2 — new tables:** `metering.routing_attempts`, `metering.feedback`, `metering.signal_subject` enum;
  quality_signals split (reshape). RLS + policies. (Populate routing_attempts from trace at write.)
- **LN-3 — the inference_calls reshape (NO cost_estimated yet):** add FK cols (model_id/router_id/
  capability_id/endpoint_id/org_unit_id/hold_id FK), `cost_usd`→`cost_actual`, backfill (resolve
  free-text→ids for existing rows; *_node_id→org_unit_id via id-preservation from P5), store.rs write
  resolution, swap shield bodies → the FK schema, rewrite analytics (org-tree GROUP BY), rework rollup
  fns + MV grain, drop free-text + *_node_id. RE-SPEC the P12 test. moves.sql M-ln-*.
- **LN-4 — cost_estimated (the crate release):** edit crate `InferenceCall` (+ store trait), `make bump`
  (lockstep + cargo clean), merge crate→main, bump torii pin; add `cost_estimated` col + thread the reserve
  estimate through store.rs; shield exposes it. Isolated so ONE release covers it.
- **LN-5 — verify:** full DB suite (re-spec'd analytics), gateway build + DB-backed tests, live
  reserve→commit→rollup smoke with both costs, dbd-pattern-verifier gate, live /v1/requests + /v1/analytics.

## 8. Blast radius (from the P6 explorer — RE-VERIFY, it's evolved)

Gateway: `store.rs` (insert_inference_call — the write resolution is the big new work; the recursive CTE
already walks org_units), `routes/ledger.rs` (/v1/requests → shield), `routes/analytics.rs` (spend/
plane-split/model-mix/overview/cost-trend/quality/export — all reads; the P12 SpendGroup denorm cols go
away → org-tree walk), `chat.rs`/`judge.rs` (build InferenceCall — cost_estimated threading). DB: the 6
rollup fns (grain rework), the 2 MVs, quality_signals writers (C6/rag), the /v1/chat + /v1/spaces/ask write
paths. CRATE: `InferenceCall` (+ any adapter that constructs it). Frontend: RequestRow/RoutingTrace
contracts are preserved by the shields (verify api.ts).

## 9. Verify gates

- Full DB suite green (analytics re-spec'd; RLS coverage; cross-tenant isolation on the reshaped ledger).
- The 6 shields deny-all/service-role-mediated as appropriate; requests_ledger byte-identical to today's /v1/requests.
- C1 reserve→commit STILL fail-closed + ancestor-headroom (unchanged, but re-verify — hold_id FK added).
- cost_estimated + cost_actual both snapshotted; a since-changed model_endpoints price never recomputes history.
- Crate release: both crates lockstep-bumped, torii builds on the new pin, gateway DB-backed tests pass.
- dbd-pattern-verifier CONFORMANT. Prod backfill (resolve free-text→ids for real rows) = live txn at merge (deferred).
