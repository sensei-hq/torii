# C3 · Budgets, metering & reconciliation — Spec

**Module:** [C3](../modules/C3-budgets-metering.md) · **Plane:** Central · **Status:** Planned — build-ready · **Depends on:** [F1](../specs/F1-data-model.md) (schema), [F2](../modules/F2-identity-auth-rbac.md) (capabilities/JWT), [C1](../modules/C1-gateway-service.md) (hot path + `GatewayStore`) · **Enables:** [O1](../modules/O1-ledger-audit.md)/[O2](../modules/O2-analytics.md) (ledger source), [W1](../modules/W1-admin-portal.md) (budget tree UI), [W2](../modules/W2-member-console.md) (spend chips), [D4](../modules/D4-config-sync.md)/[C2](../modules/C2-routing-resilience.md) (step-down / free floor)
**Date:** 2026-07-23 · **Engine:** `sensei-*` crates @ `v0.4.6` · **Authoritative record:** [`../DECISIONS.md`](../DECISIONS.md) §2 (W1, W2), §3 (one ledger)

---

> **Premise (DECISIONS §2 W2).** *No caller can be surprised by a bill.* Every priced call passes a synchronous, concurrency-safe **reserve → commit** against a `service_role`-only ledger before it reaches a provider. `hard`-capped nodes **cannot** be exceeded even under concurrency; `soft` nodes allow bounded overshoot + alert. **Budget binds to the caller's identity/node in the org→dept→team→user tree — never to a key, credential, or provider.** Client-facing metering is read-only; all mutations go through C1 domain RPCs that check capabilities server-side.

---

## 1. Purpose & scope

Enforce spend authoritatively and meter it exactly, so a tenant can never be surprised by a bill and no member can quietly overspend. C3 owns:

- the **budget tree** (`budget_nodes`: org→dept→team→user, plus `service` leaves) with caps / period / hard-vs-soft / alert threshold / free-floor;
- the **hard reserve→commit protocol** (row/advisory-locked path, every-ancestor-headroom, `reserved` hold → commit actual cost → `spent_amount` rollup, release on failure) — concurrency-safe hard caps;
- **soft-node** bounded overshoot + alert, and **free-floor step-down** when a hard node is exhausted;
- **metering** on the single authoritative **`inference_calls`** ledger (with org→dept→team→user attribution + rollup; `gateway_tasks` cost fields retired);
- **device/local-usage reconciliation** with anti-spoof (signed, idempotent buffers + hot-path device-status check);
- **`budget_requests`** (member requests an increase → approver with `budget.write` grants → applied to a node cap).

**Depends on:** F1 (owns the DDL for `budget_nodes`/`inference_calls`/`budget_requests`/alert tables; C3 specifies their behavioral contract and the deltas below); F2 (the `budget.write` capability + resolved-capability JWT claim); C1 (invokes C3's reserve/commit inline on the inference hot path and implements `GatewayStore`).

**Enables:** O1/O2 read the same `inference_calls` ledger; W1 renders the budget tree editor; W2 renders read-only spend chips + the member increase-request UI; C2/D4 consume the step-down / free-floor signal.

**Out of scope:** the DDL syntax itself (F1 / `F1-rework-plan.md` RW7/RW8/RW10); provider credential handling (F3); external billing/invoicing (Stripe) — **not ratified**, see §10; routing/circuit-breaker mechanics (C2); the crate's model-selection cost filter (C1 wraps it, but reserve→commit is consumer-side).

---

## 2. Responsibilities

1. **Pre-call reservation** — resolve the authenticated caller → their leaf `budget_node` → run the ancestor cascade under a path lock, write a `reserved` hold, and admit or reject the call (hard) / admit + flag overshoot (soft).
2. **Post-call commit** — replace the reservation's estimate with the actual metered cost from the provider response, roll up `spent_amount` along the path, and release the hold's reserved amount.
3. **Failure release** — on provider error / abort, release the reservation with zero committed cost so headroom is restored.
4. **Metering & attribution** — write every call to `inference_calls` with org/dept/team/user node attribution + the leaf `budget_node_id`, tokens, actual `cost_usd`, `execution_location`.
5. **Step-down & free floor** — when a hard node has no headroom, signal C2 to step down; if the leaf has `free_floor_enabled`, admit the call **only** on the free (local, zero-cost) plane; otherwise reject with a typed budget error.
6. **Soft overshoot & alerts** — allow soft nodes to exceed their cap by a bounded margin, emit `budget.alert` at the threshold and `budget.overshoot`/`budget.exhausted` events.
7. **Reconciliation** — ingest device-reported local/cloud usage (signed, idempotent), fold it into `inference_calls`, and re-derive `spent_amount` from the ledger; detect + quarantine spoofed/replayed/under-reported buffers.
8. **Increase requests** — expose `budget_requests` create (member, self-owned) → approve/reject (capability-gated) → apply to `budget_nodes.cap_amount`.
9. **Period accounting** — track the current period window per node, reset `spent_amount`/`reserved_amount` rollups on period roll, keep the ledger as the immutable truth.

---

## 3. Data model (F1 tables owned / used)

C3 is the **behavioral owner** of the budget/metering tables; F1 (`F1-rework-plan.md` RW7/RW8/RW10) owns their DDL. Where C3 needs a column that the built schema lacks, it is listed as a **required F1 delta** and must be coordinated into the F1 rework — not invented ad hoc.

### 3.1 `public.budget_nodes` (owned) — the org→dept→team→user tree

Built columns (keep): `tenant_id`, `id`, `parent_id` (composite self-FK `(tenant_id, parent_id)` keeps the tree in-tenant), `kind ∈ {org,dept,team,user,service}`, `name`, `ref_id` (→ the `profile`/`team`/`service_account` this node maps to), `cap_amount numeric(12,2)`, `period ∈ {daily,weekly,monthly}`, `enforcement ∈ {hard,soft}`, `alert_threshold numeric(4,3)` (fraction 0..1), `free_floor_enabled bool`, `spent_amount numeric(12,2)` (rollup), `currency`, audit cols.

**Required F1 deltas (C3-driven, into RW7):**
- `reserved_amount numeric(12,2) not null default 0` — sum of *active* holds along/at this node; **headroom = `cap_amount − spent_amount − reserved_amount`**. Without it, reserve is not concurrency-safe.
- `period_started_at timestamptz not null default now()` — anchor for the current window; the reset job zeroes `spent_amount`/`reserved_amount` when `now()` crosses the period boundary.
- `soft_overshoot_limit numeric(4,3) null` — soft nodes may exceed `cap_amount` by up to this fraction (default policy `0.10` = 10%) before hard-blocking; NULL = unbounded overshoot (alert-only).
- Invariant: exactly one `kind='org'` **root** per tenant (`parent_id is null`); a `service` leaf's `ref_id` → `service_accounts.id` (`kind='service'`, DECISIONS §1.2). `ref_id` for a `user` leaf → `profile_id`; the mapping caller-identity → leaf node is the sole binding point (never a key/credential).

### 3.2 `public.budget_holds` (owned) — **NEW** (required F1 delta, RW7)

The reservation ledger that makes hard caps concurrency-safe. One row per in-flight reservation.

| column | type | note |
|---|---|---|
| `tenant_id` | uuid | FK `core.tenants` |
| `id` | uuid | PK `(tenant_id,id)` |
| `leaf_node_id` | uuid | FK `(tenant_id, budget_nodes.id)` — the caller's leaf |
| `path_node_ids` | uuid[] | denormalized ancestor path leaf→root at reserve time (audit / release replay) |
| `reserved_amount` | numeric(12,6) | the pre-flight estimate held |
| `committed_amount` | numeric(12,6) null | actual cost written at commit |
| `inference_call_id` | uuid null | links to the ledger row on commit |
| `status` | varchar(12) | `reserved` \| `committed` \| `released` \| `expired` |
| `idempotency_key` | text | unique `(tenant_id, idempotency_key)` — the request/attempt id (prevents double-reserve/replay) |
| `created_at` / `settled_at` | timestamptz | reserve / commit\|release time |

`reserved` holds older than a TTL (default **120 s**, ≥ max provider timeout) are swept to `expired` by a reaper and their `reserved_amount` released (defends against a crashed C1 leaking headroom).

### 3.3 `public.inference_calls` (used — the single authoritative ledger)

Matches the crate's `GatewayStore::InferenceCall` (built DDL exists). The crate already carries `subject_id: Option<Uuid>` + `tier` and `insert_inference_call` / `get_spend_since` / `get_spend_by_model_since` / `get_usage_since`.

**Required deltas for node attribution + rollup (GH-5, into F1 RW7):**
- `budget_node_id uuid` — the leaf node the call was metered against (FK `(tenant_id, budget_nodes.id)`).
- `org_node_id`, `dept_node_id`, `team_node_id`, `user_node_id uuid` — denormalized ancestor path (null where a level is absent) for O2 group-by without recursive joins.
- `execution_location varchar(10)` (`local|cloud`) — split-plane attribution (also on the trace via GH-1).
- `hold_id uuid null` — back-reference to the `budget_holds` row that governed this call.
- `subject_id`/`tier` retained but **`subject_id` is set to the leaf `budget_node_id`** so the crate's `get_usage_since(subject_id, …)` returns node usage for free.

`gateway_tasks` cost/metering fields are **retired** (DECISIONS §3); `inference_calls` is the single budget source of truth **and** the O1/O2 analytics source. `service_role`-write only; clients get tenant-scoped read-only SELECT.

### 3.4 `public.budget_requests` (owned) — **NEW** (F1 RW7)

`tenant_id, id, node_id (FK budget_nodes), requested_by (profile), requested_cap numeric(12,2), current_cap numeric(12,2), reason text, status ∈ {pending,approved,rejected}, decided_by (profile, null), decided_at, created_at`. Member INSERTs own row (self-owned benign write); approve/reject + application to `cap_amount` is `service_role`-write via the C1 RPC (capability `budget.write`).

### 3.5 Alerts (owned) — **NEW** (F1 RW8)

`alert_rules` (tenant, scope node_id/global, metric `spend_pct|spend_abs|overshoot`, threshold, window, channel_ids[]), `notification_channels` (tenant, kind `email|slack|webhook|siem`, config jsonb, enabled), `alert_events` (tenant, rule_id, node_id, fired_at, payload jsonb, dispatch_status). Tenant-scoped SELECT; `service_role`-write. C3 evaluates rules on commit/reconcile and emits `alert_events` + dispatches.

### 3.6 Read-only views (for W1/W2/O2)

- `budget_node_status` — per node: `cap_amount`, `spent_amount`, `reserved_amount`, computed `headroom`, `utilization = spent/cap`, `period_started_at`, `period_ends_at`. Tenant-RLS SELECT.
- Spend chips (W2) read `budget_node_status` for the caller's leaf + ancestors.

---

## 4. Contracts

### 4.1 Internal Rust — the reserve/commit service (invoked by C1 inline on the hot path)

```rust
/// C3 budget enforcer. Lives in the central gateway (services/gateway), backed by
/// the DB functions in §4.3. NOT a public HTTP endpoint — it runs inside C1's
/// inference handler around the engine `execute`/`execute_stream` call.
#[async_trait]
pub trait BudgetService: Send + Sync {
    /// Pre-call. Resolves caller identity → leaf node, locks the ancestor path,
    /// checks every-ancestor-headroom, writes a `reserved` hold.
    /// - hard node with no headroom + free_floor → Ok(Reservation{ plane: Free })
    /// - hard node, no headroom, no free_floor  → Err(BudgetExceeded)
    /// - soft node over cap (within overshoot)  → Ok(Reservation{ overshoot: true })
    async fn reserve(&self, ctx: &AuthContext, est: CostEstimate, idem: &str)
        -> Result<Reservation, BudgetError>;

    /// Post-call success. Writes actual cost to the hold + `inference_calls`,
    /// rolls up spent_amount along the path, releases the held estimate.
    async fn commit(&self, r: &Reservation, actual: Cost, call: InferenceCallMeta)
        -> Result<(), BudgetError>;

    /// Post-call failure/abort. Releases the reservation, commits zero cost.
    async fn release(&self, r: &Reservation, reason: ReleaseReason) -> Result<(), BudgetError>;
}

pub struct Reservation {
    pub hold_id: Uuid,
    pub leaf_node_id: Uuid,
    pub plane: Plane,          // Cloud | Free (free-floor step-down engaged)
    pub overshoot: bool,       // soft node admitted over cap
    pub headroom_after: f64,
}

pub enum BudgetError {
    BudgetExceeded { node_id: Uuid, kind: NodeKind, headroom: f64, estimated: f64 },
    NoBudgetNode { subject: Uuid },   // caller has no leaf node — deny (fail-closed)
    Locked,                           // lock timeout → retryable
    Store(GatewayError),
}
```

Idempotency: `reserve` is keyed on `idem` (the request/attempt id) via `budget_holds.idempotency_key`; a retried reserve returns the existing hold instead of double-holding. `commit`/`release` are idempotent on `hold_id` (no-op if already settled).

### 4.2 HTTP — C1 domain RPCs (gateway-mediated writes, DECISIONS §2 W1)

Per-domain endpoints (not a generic blob); each checks the capability server-side from the JWT-resolved capability set.

| Method + path | Capability | Body / effect |
|---|---|---|
| `GET /v1/budgets/tree` | tenant member (read) | Returns the caller-visible `budget_node_status` subtree. |
| `POST /rpc/budgets/upsert-node` | `budget.write` | Create/update a node (`kind`, `parent_id`, `cap_amount`, `period`, `enforcement`, `alert_threshold`, `free_floor_enabled`, `soft_overshoot_limit`). |
| `POST /rpc/budgets/delete-node` | `budget.write` | Remove a node by `{id}` (cascades to descendants; rejected if it would orphan spend). |
| `POST /rpc/budgets/request-increase` | member (self-owned) | Member creates an increase request (`node_id`, `requested_cap`, `reason`) → `budget_requests(status=pending)`. |
| `POST /rpc/budgets/approve-request` | `budget.write` | Approve `{id}` → set `budget_nodes.cap_amount = requested_cap`, `status=approved`, emit `budget.request.approved`. |
| `POST /rpc/budgets/reject-request` | `budget.write` | Reject `{id}` → `status=rejected`. |
| `POST /v1/usage/report` | enrolled device token | Signed, idempotent device usage buffer (§4.4). |
| `GET /v1/budgets/nodes/{id}/spend` | tenant member (read, subtree-scoped) | Spend over a window (wraps `get_spend_since` / `get_spend_by_model_since`). |

All privileged writes are rejected on missing capability with `403 { error: "capability_required", capability: "budget.write" }`. Clients **never** PostgREST-write these tables.

### 4.3 DB functions (`SECURITY DEFINER`, service_role) — the concurrency-safe core

```sql
-- Reserve: lock the path, verify every ancestor, write a hold. Returns hold + plane.
-- Concurrency safety comes from SELECT … FOR UPDATE on the ordered path rows
-- (leaf→root), which serializes concurrent reserves on the same subtree.
budget_reserve(p_tenant uuid, p_leaf uuid, p_estimate numeric, p_idem text)
  returns table(hold_id uuid, plane text, overshoot bool, headroom numeric);

-- Commit: set committed_amount, spent_amount += actual along the path, release the
-- held estimate (reserved_amount -= estimate along the path), link inference_call.
budget_commit(p_tenant uuid, p_hold uuid, p_actual numeric, p_call uuid) returns void;

-- Release: reserved_amount -= estimate along the path, mark hold released/expired.
budget_release(p_tenant uuid, p_hold uuid, p_reason text) returns void;

-- Headroom helper (read): cap - spent - reserved for a node.
budget_headroom(p_tenant uuid, p_node uuid) returns numeric;
```

`budget_reserve` body (canonical algorithm):
1. Resolve the ancestor path `leaf→root` (`WITH RECURSIVE` on `parent_id`).
2. `SELECT … FROM budget_nodes WHERE id = ANY(path) ORDER BY id FOR UPDATE` — lock **in a deterministic order** (avoids deadlock between overlapping subtrees).
3. For **every** node in path: `headroom = cap_amount − spent_amount − reserved_amount`. If any `hard` node has `headroom < estimate` → free-floor branch or raise `BudgetExceeded`. `soft` nodes over cap within `soft_overshoot_limit` pass with `overshoot=true`; beyond it, treat as hard-block.
4. Insert `budget_holds(status=reserved, idempotency_key=p_idem)` (ON CONFLICT on idem → return existing).
5. `UPDATE budget_nodes SET reserved_amount = reserved_amount + estimate WHERE id = ANY(path)`.

### 4.4 Signed device usage report (reconciliation ingest)

```jsonc
{
  "device_id": "…", "tenant_id": "…", "leaf_node_id": "…",
  "buffer_seq": 42,                       // monotonic per device (anti-replay)
  "idempotency_key": "device:…:seq:42",   // unique; re-submits are no-ops
  "calls": [ { "call_id": "…", "capability": "text_chat", "model": "…",
               "execution_location": "local", "input_tokens": 512,
               "output_tokens": 128, "cost_usd": 0.0, "recorded_at": "…" } ],
  "signature": "ed25519(device_privkey, canonical(payload))"
}
```
Verified against the device's enrolled pubkey (F2). Rejected if: signature invalid, device `status != active` (revoked device with a live JWT cannot spend — DECISIONS §2 apply-without-asking), `buffer_seq` ≤ last accepted (replay), or `idempotency_key` already seen. Accepted calls are inserted into `inference_calls` (execution_location=local; local calls are typically `cost_usd=0` but tokens are counted for O2/quota), then `spent_amount` is re-derived and remaining pushed back via Realtime (D4).

### 4.5 Events (emitted to O1 + Realtime)

`budget.reserved`, `budget.committed`, `budget.released`, `budget.alert` (threshold crossed), `budget.overshoot` (soft node over cap), `budget.exhausted` (hard node hit cap → step-down/free-floor engaged), `budget.request.created|approved|rejected`, `budget.reconciled`, `budget.spoof_detected` (rejected device buffer). Each carries `tenant_id`, `node_id`, and lands as an `audit_events`/`alert_events` row.

---

## 5. Security & RLS

- **Tenant isolation.** Every C3 table carries `tenant_id`; RLS predicate `tenant_id = (auth.jwt()->>'tenant_id')::uuid`. The service role (C1) bypasses RLS and scopes explicitly in code.
- **Write authority (gateway-mediated, §2 W1).** `budget_nodes`, `budget_holds`, `inference_calls`, `alert_rules`, `notification_channels`, `alert_events`, and the *approval/application* of `budget_requests` are **`service_role`-write-only**. `authenticated`/`anon` have INSERT/UPDATE/DELETE **REVOKE**d. The **only** client write is `INSERT` of a member's **own** `budget_requests` row (`requested_by = auth.uid()`, `status='pending'`, no `cap_amount` field writable) — a self-owned benign write.
- **Read.** Clients get tenant-scoped `SELECT` on `budget_nodes`/`budget_node_status`/`inference_calls`/`budget_requests` (own or subtree). `budget_holds` is `service_role`-only (no client read).
- **Capability authz (F2 owns the canonical list).** All privileged budget mutations require the `budget.write` capability, resolved server-side from `role_permissions` via the JWT-carried `role_ids` — the JWT does **not** carry a raw budget-edit grant. RLS predicate checks use the F2 `SECURITY DEFINER` capability-resolver helper. A member without `budget.write` cannot raise any cap (closes the built self-budget-raise hole).
- **Budget binds to identity/node, never to a key.** At execution C1 resolves the authenticated caller (person or `service_account`) → their leaf `budget_node` (via `ref_id`), and meters there. `api_keys` carry **no budget**; multiple keys for one identity share that identity's node (DECISIONS §1.2 / §2 W2).
- **Anti-spoof / anti-replay.** Device buffers are Ed25519-signed + idempotent + monotonic-sequenced; the C1 hot path runs a per-request **device-status check** (short-TTL cache, Realtime-invalidated) so a revoked device stops spending immediately.
- **Redaction.** C3 stores only tokens/cost/model-name/node-id metadata — no prompt/response content, so no secret/PII redaction surface here (W5 redaction happens upstream in C1/C4). `budget_requests.reason` is free text → runs through the same C4 redaction pass before persistence.
- **Fail-closed.** A caller with no resolvable leaf node is **denied** (`NoBudgetNode`), never admitted with an implicit unlimited budget. Lock-timeout on `budget_reserve` returns a retryable error, not an admit.

---

## 6. Key flows

1. **Priced cloud call (happy path).** C1 authenticates → resolves leaf node → `estimate_cost` (crate) → `BudgetService.reserve(ctx, est, attempt_id)` → `budget_reserve` locks path, all ancestors have headroom, writes `reserved` hold, `reserved_amount += est` up the path → C1 calls the provider via the engine → on response, `commit(actual)` → `spent_amount += actual` up the path, `reserved_amount -= est`, hold→`committed`, `inference_calls` row inserted with node attribution → `budget.committed` event.

2. **Hard cap race (the invariant).** Two concurrent calls target the same near-full `hard` team node. Both enter `budget_reserve`; the `SELECT … FOR UPDATE` on the ordered path serializes them. The first reserves the remaining headroom; the second sees `headroom < estimate` and is rejected (or free-floored). **The cap is never exceeded** — this is the RW12 concurrency test.

3. **Free-floor step-down.** A `hard` leaf (or any ancestor) has no headroom but `free_floor_enabled=true`. `reserve` returns `Reservation{ plane: Free }`; C1/C2 route to the free local model (zero-cost, desktop plane), emits `budget.exhausted`. The call succeeds at no cost; nothing is committed against the cap.

4. **Hard cap, no free floor.** No headroom, `free_floor_enabled=false` → `reserve` → `Err(BudgetExceeded)` → C1 returns `402/429` typed budget error; nothing spent.

5. **Soft overshoot + alert.** A `soft` node is over `cap_amount` but within `soft_overshoot_limit`. `reserve` admits with `overshoot=true`, emits `budget.overshoot`; commit proceeds. Beyond the overshoot limit it hard-blocks. Crossing `alert_threshold` (on any node) fires `budget.alert` → `alert_events` + channel dispatch.

6. **Provider failure.** Reserve succeeds, provider errors/times out → C1 calls `release(hold, reason=ProviderError)` → `reserved_amount -= est` up the path; no `spent_amount` change; hold→`released`. Reaper sweeps any hold left `reserved` past TTL → `expired` + release.

7. **Device/local reconciliation.** Desktop batches local calls into a signed buffer → `POST /v1/usage/report` → signature/device-status/replay checks pass → calls inserted into `inference_calls` (execution_location=local) → `spent_amount` re-derived from ledger → updated remaining pushed via Realtime (D4). A spoofed/replayed/revoked-device buffer is rejected → `budget.spoof_detected`.

8. **Increase request.** Member (no `budget.write`) `POST /rpc/budgets/request-increase` → `budget_requests(pending)` → W1 shows it to an approver → approver with `budget.write` `POST /rpc/budgets/approve-request` → `cap_amount` updated, `budget.request.approved` event, remaining re-pushed.

9. **Period roll.** A scheduled job (or lazy check on first reserve of a new window) detects `now()` crossed `period_started_at + period` → zeroes `spent_amount`/`reserved_amount`, advances `period_started_at`. The `inference_calls` ledger is untouched (immutable truth); rollups are a fast cache reconciled against it.

10. **Reconciliation audit.** Periodically, C3 re-derives each node's `spent_amount` for the current window from `inference_calls` (sum over path attribution) and compares to the maintained rollup; drift beyond a tolerance emits `budget.reconciled` with the correction and an `audit_events` row.

---

## 7. Gateway-crate dependencies

- **GH-4 — Hard reserve→commit affordance (resolved: consumer-side).** Verified on disk: `sensei-gateway::budget` (`estimate_cost`/`filter_by_budget`) is **affordability-only** (partition by `estimated ≤ budget`), the request-scoped `budget: Option<f64>` cap is enforced by candidate *filtering* in `selection.rs`, and `GatewayError::BudgetExceeded` is **dormant** (constructed only in tests). There is **no** concurrency-safe pre-call reserve in the crate. → **C3 implements reserve→commit consumer-side** (the `BudgetService` trait + DB functions in §4). No blocking crate change; optionally the crate's per-request `budget` cap is still passed as a *soft affordability hint* into selection, but it is **not** the authority. (Backlog GH-4 → close as "consumer-side".)
- **GH-5 — `inference_calls` ledger shape (blocking for attribution).** Verified: the crate owns `GatewayStore::InferenceCall`, which has a single `subject_id: Option<Uuid>` + `tier` and `insert_inference_call`/`get_spend_since`/`get_spend_by_model_since`/`get_usage_since` — but **no** org→dept→team→user attribution. → File the gateway-repo issue to extend `InferenceCall` with `budget_node_id` + the denormalized `{org,dept,team,user}_node_id` path + `execution_location` + `hold_id`, and set `subject_id = budget_node_id` so `get_usage_since` returns node usage. C3's Postgres `GatewayStore` impl (in C1) writes these columns. **Sequence before the C3 build phase** (create → implement → close → lockstep tag bump).
- **GH-1 — per-step `plane`/execution-location on the trace** (owned by C2/D3) supplies `execution_location` for the ledger; C3 consumes it, does not own it.
- **Crate reuse:** `estimate_cost`/`Cost::from_usage`/`ModelPricing`/`CostEstimate`/`TokenUsage` for the estimate + actual figures; `GatewayStore` for ledger persistence. Reserve→commit and the cascade/rollup are **not** in the crate — they are C1/DB.

---

## 8. Decisions resolved

- **Hard vs soft per node (DECISIONS §2 W2).** `hard` = synchronous, path-locked reserve→commit; **cannot** be exceeded under concurrency. `soft` = bounded overshoot (`soft_overshoot_limit`, default 10%) + alert, hard-blocks beyond the margin. Per-node `enforcement` flag. *Rationale: matches the ratified premise and the built `budget_nodes.enforcement` column.*
- **Where reserve→commit lives.** **Consumer-side in C1 + DB**, not the crate (GH-4 finding: crate budget is affordability-only). *Rationale: the crate cannot do a concurrency-safe cross-node reservation; the DB `FOR UPDATE` path lock can.*
- **How concurrency safety is achieved.** `SELECT … FOR UPDATE` on the ancestor path rows **in deterministic order** + a `reserved_amount` rollup column. *Rationale: serializes overlapping-subtree reservers without a global lock; deterministic order avoids deadlock; advisory locks are the fallback if row-lock contention is measured too high.*
- **Reservation storage.** A dedicated `budget_holds` table + a `reserved_amount` rollup on `budget_nodes` (new F1 deltas), rather than overloading `spent_amount`. *Rationale: keeps committed spend and in-flight holds distinct, enables TTL sweep + audit, and lets headroom = cap − spent − reserved be a single arithmetic check.*
- **Budget binding.** Budget binds to the caller **identity/leaf node** (`budget_nodes.ref_id`), never to `api_keys`/credentials; multiple keys for one identity share the node. *Rationale: DECISIONS §1.2 / §2 W2.*
- **Ledger consolidation.** `inference_calls` is the single `service_role`-only ledger with node attribution + rollup; `gateway_tasks` cost fields retired. `subject_id := budget_node_id`. *Rationale: DECISIONS §3, reuses the crate's `get_usage_since`.*
- **`spent_amount`: rollup + ledger-truth.** Maintain a fast `spent_amount` rollup for reserve, but treat `inference_calls` as immutable truth and reconcile the rollup against it (flow 10). *Rationale: fast hot-path headroom without trusting a mutable counter as the sole record.*
- **Free floor.** When a hard node is exhausted and `free_floor_enabled`, admit **only** on the free local plane (zero cost); otherwise reject. *Rationale: "never a surprise bill" while preserving a usable degraded mode on desktop.*
- **Period reset.** Per-node `period_started_at` + lazy/scheduled reset of the rollups; ledger never reset. *Rationale: windowed caps (D/W/M) with an auditable trail.*
- **Anti-spoof.** Ed25519-signed, monotonic-sequenced, idempotent device buffers + hot-path device-status check. *Rationale: DECISIONS §2 apply-without-asking (offline buffers signed + idempotent; revoked device stops spending).*
- **Increase requests.** Members can only INSERT their own `pending` `budget_requests`; approval/application is `budget.write` via the C1 RPC. *Rationale: §2 W1 closes the self-raise hole while keeping a member-facing path.*

---

## 9. Acceptance criteria (observable, testable)

1. **Hard cap holds under concurrency.** Given a `hard` node with headroom `H` and `N` concurrent calls each estimating `> H/N`, the sum of committed spend ≤ cap; excess calls receive `BudgetExceeded` (or free-floor). Verified by the RW12 concurrency test (`≤ headroom admitted`).
2. **Ancestor cascade.** Given a leaf with headroom but a `hard` ancestor (team/dept/org) at cap, the call is rejected/free-floored — every ancestor must have headroom.
3. **Reserve→commit accounting.** After a successful priced call, the leaf and every ancestor's `spent_amount` increased by the **actual** cost (not the estimate), `reserved_amount` returned to its pre-call value, and the hold is `committed` with `inference_call_id` set.
4. **Release restores headroom.** On provider failure, `reserved_amount` returns to pre-call value, `spent_amount` unchanged, hold `released`; a crashed reserve is reclaimed by the TTL reaper within the TTL window.
5. **Soft overshoot bounded.** A `soft` node admits calls over cap up to `soft_overshoot_limit` (emitting `budget.overshoot`) and hard-blocks beyond it; `budget.alert` fires exactly once per window when `alert_threshold` is crossed.
6. **Free-floor step-down.** With `free_floor_enabled` and no headroom, the call completes on the local free plane at `cost_usd=0` and nothing accrues to the cap; `budget.exhausted` emitted.
7. **Ledger attribution.** Every `inference_calls` row written by the gateway has non-null `budget_node_id` + the denormalized ancestor path; O2 can group spend by org/dept/team/user without recursion; `gateway_tasks` holds no cost fields.
8. **Client cannot self-raise.** A member JWT lacking `budget.write` attempting to `UPDATE budget_nodes.cap_amount` (PostgREST) or `POST /rpc/budgets/approve-request` is denied (RW1/RW12 negative test); the only permitted client budget write is INSERT of an own `pending` `budget_requests` row.
9. **Increase request round-trip.** Member request → approver approves → `cap_amount` reflects `requested_cap`, `status=approved`, updated remaining pushed to the member client via Realtime.
10. **Anti-spoof reconciliation.** A device buffer with a bad signature, a revoked device, a stale `buffer_seq`, or a duplicate `idempotency_key` is rejected (`budget.spoof_detected`); a valid buffer's local calls appear in `inference_calls` (execution_location=local) exactly once and update remaining.
11. **No secret leakage.** `budget_holds` is unreadable by `authenticated`; `inference_calls` exposes no prompt/response content; `budget_requests.reason` passes the redaction check.
12. **Reconciliation drift.** Injecting an out-of-band `inference_calls` row makes flow-10 reconciliation correct the `spent_amount` rollup and emit `budget.reconciled` + an audit row.

---

## 10. Open questions

- **External billing/invoicing (Stripe).** The Billing mockup exists but external invoicing is **not ratified** in DECISIONS (internal metering is authoritative). Whether v1 emits usage to a billing provider is a product call, not a build blocker — internal caps/metering ship regardless.
- **Currency.** The crate hard-codes USD everywhere; `budget_nodes.currency` exists but multi-currency conversion is unspecified. v1 assumes USD; multi-currency (FX at commit time) is deferred unless a tenant requires it.
- **Advisory vs row locks at scale.** §4.3 specifies `FOR UPDATE` path locks; if a very hot shared org root shows lock contention in load testing, fall back to per-path `pg_advisory_xact_lock` on a hash of the leaf path. Decision deferred to load-test evidence (not a correctness question — both are concurrency-safe).
- **Reserve estimate basis for streaming.** The pre-flight estimate uses `max_output_tokens` (worst case); for long streaming responses this can over-hold headroom transiently. Acceptable for v1 (released at commit); a mid-stream re-reserve is a possible later refinement.
