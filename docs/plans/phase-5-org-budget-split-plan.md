# §D Phase 5 — org/budget split (build plan)

**Status:** grounded + designed 2026-08-05, executing. Widest, most security-sensitive §D
phase (C1 hot-path reserve + analytics scope-authz). Follows the proven shield-first move recipe
+ `tests/moves.sql` guard + `dbd-pattern-verifier` gate. Dev DB 55322, pre-release.

Resumes after Phases 1–4 (memory: `project-db-schema-moves.md`). Ratified decisions in
`project-db-phase5-org-budget.md`.

---

## 1. The split

Today `public.budget_nodes` **conflates** org structure + budget cap. Split into:

- **`core.org_units`** (the ONE tree): `pk(tenant_id,id)`, self-FK `parent_id`, `level int`
  (tier ordinal → `unit_levels`), `name`, `is_personal bool`.
- **`core.unit_levels`** (per-tenant labels): `pk(tenant_id,level)`, `label`.
- **`core.unit_members`**: `pk(tenant_id,unit_id,profile_id)` (people→units).
- **`governance.nodes`** (← `budget_nodes`): `pk(tenant_id,id)`, `org_unit_id` FK→`core.org_units`,
  **all** budget cols; DROP `kind`/`parent_id`/`ref_id` (structure now from `org_units.parent_id`).

## 2. Ratified decisions (Jerry, 2026-08-05)

1. **1:1** budget_node → one org_unit + one governance.nodes row.
2. `kind`→`level`: org=0, dept=1, team=2, **personal=3**, **service=4** (`is_personal=false`, its own tier).
   `level` is a **tier label, not tree depth** (a service/personal node can hang off a team). No `level==depth` CHECK.
3. `unit_members` seeds **personal units only** (from `kind='user'` nodes); dept/team → SCIM fast-follow.
4. Downstream FKs **deferred**: `inference_calls.org_unit_id`→P6, `spaces.org_unit_id`→P7.
5. `content.projects` / `inference_calls.project_id` deferred.

## 3. Derived implementation choices (mine — flag for human review)

These follow from §2 + minimal-churn; **not** independently ratified:

- **DC-1 — `governance.nodes.id == org_unit_id` (same id, enforced `CHECK (id = org_unit_id)` + `UNIQUE(tenant_id, org_unit_id)`).**
  Makes node-id and unit-id interchangeable, so: the hot-path reserve contract is preserved
  (`resolve_node` still returns one id → `chat.rs`/`judge.rs` call sites **untouched**); `budget_holds.budget_node_id`
  + `budget_requests.node_id` FK→`governance.nodes` (matches design §106/§107); and the ledger's
  `budget_node_id`/`*_node_id` (which store budget-node ids today) stay valid as org_unit ids →
  **no ledger data migration**, and P6's `inference_calls.org_unit_id` rename becomes trivial.
- **DC-2 — id-preserving backfill:** each `budget_node` → `org_unit`(id = node.id) + `governance.nodes`(id = node.id, org_unit_id = node.id). Consistent with DC-1.
- **DC-3 — keep `budget_reserve/commit/release` functions + `budget_holds` + `budget_requests` in `public`**
  (only `budget_nodes`→`governance.nodes` changes schema, honoring decision #4 "governance.nodes ONLY").
  Rewrite the function **bodies** to walk `core.org_units.parent_id` then join `governance.nodes` on
  `org_unit_id` for caps. Their schema move (→ `governance.holds`/`requests`) is a later slice.
- **DC-4 — shield `kind` derived from `org_units.level`** via `core.unit_kind(level)` (0→org…4→service),
  **not** `unit_levels.label` — the frontend (`org-tree.ts` `KIND_RANK`/`childKind`) keys on the machine
  values `{org,dept,team,user,service}`, so byte-identical requires them. `unit_levels.label` is the
  separate human relabel (Organization screen).

## 4. Shield contracts (ship FIRST, over OLD schema, then swap body)

Gateway-internal (deny-all, **never** granted to authenticated — Phase 3 leak lesson).

- **`governance.budget_tree_for_tenant`** → `BudgetNode{id, parent_id, kind, name, cap_amount,
  spent_amount, reserved_amount, enforcement, period, alert_threshold, free_floor_enabled}`.
  Byte-identical to current `ledger.rs:187` read. Backs `/v1/budgets` (nodes).
- **`governance.budget_requests_for_tenant`** → `BudgetRequest{id, node_id, requested_by, requested_cap,
  reason, status, created_at}`. Backs `/v1/budgets` (requests).

## 5. Blast radius (verified via explorer + reads)

**DB (`database/`):** `budget_nodes.ddl`→`governance/nodes.ddl` (reshape); new `core/{org_units,unit_levels,unit_members}.ddl`;
`budget_holds.ddl`/`budget_requests.ddl` FK repoint; `budget_reserve/commit/release.ddl` body rewrite;
`analytics_overview_current.ddl` root-cap subquery; `import/seed_rework.sql` (seed unit+levels+node);
policies `grants.sql`/`tenant_isolation.sql` (`public.budget_nodes`→`governance.nodes`; + 3 new core tables + shields deny-all);
tests `moves.sql`(+M-org-*), `budget.sql`(rewrite inserts), `authz.sql`, `enums.sql`; new `core.unit_kind(int)` fn.

**Gateway (`services/gateway/src/`):**
- `budgets.rs:48-71` `resolve_node` → resolve via `unit_members`/`org_units`/`governance.nodes` (returns the shared id).
- `store.rs:95-124` inference INSERT recursive CTE → walk `core.org_units.parent_id`, switch on `level`.
- `routes/analytics.rs`: `subtree_ids` (:55) → walk org_units; `scope_filter_for` own_leaf (:73) → unit_members/org_units;
  root cap (:182) → org_units∅+nodes; `spend_sql` node join (:396) → org_units(name,level→kind)+nodes(cap).
- `routes/ledger.rs:179-218` `/v1/budgets` → read the two shields.
- `routes/rpc.rs`: `orgs_create` (:1404 seed → unit+levels+node), `budgets_upsert_node` (:120 fork → org_units + nodes),
  `budgets_delete_node` (:185 root-guard/cascade → org_units), `budgets_request`/`approve`/`deny` (node_id→governance.nodes).
- **Untouched (confirmed):** `chat.rs`/`judge.rs` call sites; `analytics.rs` `SpendGroup`/`scope_decision` (pure);
  `inference_calls.*_node_id` columns + `SpendGroup.column()` (deferred to P6).

## 6. Slice order (shield-first; TDD guard before each)

- **S1 — shields over OLD schema:** ✅ DONE — both shield views (passthrough over current
  `public.budget_nodes`/`budget_requests`), repointed `ledger.rs` `/v1/budgets`. Verified byte-identical +
  moves.sql M-org-1/2 + full DB suite green + gateway builds. (`core.unit_kind` deferred to S3, first needed when the body swaps.)
- **S2 — new tree tables:** `core.org_units`/`unit_levels`/`unit_members` (empty) + RLS + grants + policies (SELECT-only tenant-scoped).
- **S3 — the move + backfill (one live txn on 55322 + DDL files to match):** `budget_nodes`→`governance.nodes`;
  backfill org_units/unit_levels/unit_members (id-preserving); add `org_unit_id` FK + UNIQUE + CHECK(id=org_unit_id);
  repoint `budget_holds`/`budget_requests` FKs; drop `kind`/`parent_id`/`ref_id`; swap shield bodies →
  `governance.nodes × org_units × unit_levels`; repoint matview root-cap subquery.
- **S4 — rewrite the two recursive walks + hot path:** `budget_reserve/commit/release` bodies; `resolve_node`;
  `store.rs` CTE; `routes/analytics.rs` subtree/own_leaf/root-cap/spend-join.
- **S5 — rewrite RPC writers:** `orgs_create` seed, `budgets_upsert_node` fork, `delete_node`, request/approve/deny.
- **S6 — seed + policies + full verify:** `seed_rework.sql`; grants/tenant_isolation; run full DB suite
  (RW7 ancestor-headroom, RW12 budget-raise denied, RLS coverage, fresh-build-check) + gateway build/tests +
  `dbd-pattern-verifier` gate + live `/v1/budgets`/reserve smoke.

## 7. Verification gates (must all pass)

- **C1 reserve fail-closed + ancestor headroom** (budget.sql RW7): a hard cap at any ancestor is un-exceedable.
- **Analytics scope authz** (own-subtree free / tenant-wide gated on `audit.read`) unchanged in behavior.
- **Org-tree frontend byte-stable** (`/v1/budgets` shape identical; `org-tree.spec.ts` green).
- **`/rpc/orgs/create`** seeds org_unit(root)+unit_levels+root node; login still mints; RW12 budget-raise denied.
- **RLS coverage** picks up the 3 new core tables + governance.nodes; shields deny-all (no authenticated SELECT).
- **fresh-build-check.sh** (DDL files alone reproduce the end state) + `dbd doctor`/`diff` clean.

**Prod cutover** (hosted Supabase, real tenant data) = the one-live-txn backfill in S3, run at merge time (deferred; dev proves it).
