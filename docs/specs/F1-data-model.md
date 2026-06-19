# F1 · Data model & schema — Spec

**Module:** [F1](../modules/F1-data-model.md) · **Status:** Draft for review · **Depends on:** none (root) · **Enables:** F2, F3, C1–C5, O1–O3
**Date:** 2026-06-18 · **Tooling:** dbd · **Engine:** PostgreSQL (Supabase) + `vector`

---

## 1. Purpose & scope

Define the single multi-tenant Postgres schema that every Strategos service reads and writes, the **tenant-isolation model**, and the **v1 table cut**. This spec adapts the existing [`database/`](../../database/) design (built for the old hosted product) to the split-plane SaaS: web clients hit **Supabase PostgREST under RLS**; the **central gateway uses the service role** and scopes by JWT; the desktop app pulls a config snapshot (no secrets).

Out of scope here: per-table column-by-column DDL (that's the implementation plan), and the engine config mapping (C1/C2).

---

## 2. Current state (what `database/` already has)

- **Schemas:** `core` (tenants, profile_tenants, tenant_keys, tenant_languages), `config` (providers, models, routers, capabilities, model_endpoints, model_capabilities, modules, features, feature_states, mcp_servers), `public` (router_keys, fallback_chains/models, gateway_tasks/logs, sessions/logs, documents, document_embeddings, access_groups/group_levels/_lang, document_access, profile_groups, curator_conversations, plans/planned_tasks/interactions, tenant_mcp_servers), `history` (past_*), `staging`, `extensions`.
- **Isolation:** `public` tables are `partition by list (tenant_id)`; a trigger creates per-tenant partitions on tenant insert. Composite FKs `(tenant_id, …)` keep references in-tenant.
- **Crypto:** `core.tenant_keys` (per-tenant DEK), `public.router_keys.encrypted_api_key` (AES-256-GCM `[IV][tag][ciphertext]`).
- **Views:** `effective_chain_models`, `viable_chain_models`, `user_accessible_documents`, `user_accessible_sessions`.
- **dbd:** `.ddl` files per object, `set search_path` per file, seed via `staging` + `import/loader.sql`; grants in `design.yaml` (anon/authenticated = usage+select on `config`/`public`; service_role = all).
- **Embeddings:** `document_embeddings.embedding vector(384)`, HNSW index.

---

## 3. Target for v1 — key decisions

### 3.1 Isolation: **RLS, not partition-per-tenant** *(decided ✓ 2026-06-18)*
Drop list-partitioning; isolate with **Row-Level Security** keyed on the Supabase JWT (`tenant_id` claim), keeping `tenant_id` columns + composite FKs for integrity.
- **Why:** partition-per-tenant means thousands of partitions + a DDL trigger per signup — heavy ops on managed Postgres, and Supabase RLS is the idiomatic, well-supported path. RLS also lets web clients use PostgREST directly (less custom API).
- **How:** every tenant-scoped table gets an RLS policy `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid`, composed with role/visibility predicates (§5). The **service role bypasses RLS** — the central gateway (C1) does explicit tenant scoping in code. The existing access views become RLS policies (or stay as views queried under RLS).
- **Cost/risk:** RLS correctness must be tested (a missing policy = a leak). We add a policy-coverage test that fails if any tenant table lacks an enabled policy.

### 3.2 Schema organization (keep, lightly adjusted)
- `core` — tenancy + identity bridge (service_role only).
- `config` — shared catalog + platform-managed reference (readable under RLS).
- `app` — *(renamed from `public`)* per-tenant runtime + content. *(Optional rename; `public` works too — decision 9c.)*
- `audit` — **new**: append-only governance/audit events (O1).
- `history` — change historization (keep as-is for feature/mcp history).
- `staging`, `extensions` — unchanged.

### 3.3 v1 entity cut
| Bucket | Tables |
|---|---|
| **Reuse as-is (minus partitioning)** | tenants, profile_tenants, tenant_keys, tenant_languages, providers, models, routers, capabilities, model_endpoints, model_capabilities, fallback_chains, fallback_chain_models, router_keys, sessions, session_logs, gateway_tasks, gateway_task_logs, documents, document_embeddings, access_groups, group_levels, *_lang, document_access, profile_groups, modules, features, feature_states |
| **New (this spec adds)** | **budget_nodes** (org→dept→team→user tree; period / hard-soft / alert threshold / free-floor), **spaces** (first-class), **document_collections / document_versions / document_assets** (doc mgmt §3d), **conversations / messages** (Ask threads, replaces curator), **audit_events**, **settings** (workspace + space scope), **devices** (enrollment, F2/D4). RBAC = a `role` enum column on `profile_tenants` (not new tables — §4). |
| **Deferred (pending decisions)** | mcp_servers, tenant_mcp_servers → **X1** (decision #1); plans, planned_tasks, planned_task_interactions → **X2** (decision #3); curator_conversations → **replace** with the new Ask conversations model (§4 Knowledge) |

---

## 4. Entities by domain (v1)

**Identity & tenancy** — `tenants`, `profile_tenants` (user↔tenant + **role**), `tenant_keys`, `tenant_languages`. JWT carries `tenant_id`, `role`, `groups`.

**RBAC** — **fixed roles for v1** (decision #4): Owner/Admin/Editor/Viewer/Member/Service as an enum on `profile_tenants.role`, **tenant-level** (a member's space *membership* governs access, not a per-space role). Permission checks live in RLS predicates + C1. Custom roles (`roles`/`role_permissions`/`profile_roles`) are a documented post-v1 path that won't reshape RLS.

**Catalog** — `providers`, `models`, `routers`, `capabilities`, `model_endpoints`, `model_capabilities`. Platform-tenant-owned defaults, tenant-overridable. Add `model_endpoints.local_capable` flag (for the split-plane / D3).

**Routing** — `fallback_chains`, `fallback_chain_models` (+ **per-step plane** flag `local|cloud`, C2) + space/role binding. Keep `effective_chain_models` / `viable_chain_models` resolution as views.

**Budgets (new)** — `budget_nodes` (self-referential tree: org→dept→team→user, `cap`, `period D|W|M`, `hard|soft`, `alert_threshold`, `free_floor_enabled`, `spent` rollup), mapped onto people/teams/depts. Enforced by C3; metered from `gateway_tasks`.

**Key vault** — `tenant_keys`, `router_keys` (encrypted, RLS-locked — **no client SELECT**; only service role decrypts in C1/F3).

**Knowledge** — `spaces` (new first-class: name, classification, owner, members via `access_groups`), `documents` (+ `space_id`, status), `document_collections`, `document_versions`, `document_assets` (extracted md/csv/images in Storage), `document_embeddings` (`vector(1024)`), `access_groups`/`group_levels`/`document_access`/`profile_groups` (access control), and **`conversations`/`messages`** (replaces `curator_conversations`; Ask threads with citations).

**Runtime** — `sessions`, `session_logs`, `gateway_tasks`, `gateway_task_logs` (+ **execution_location** `local|cloud` for the split-plane ledger, O1).

**Governance** — `audit_events` (new, append-only; O1), `settings` (new; workspace + space scope = the 3-level control model), `modules`/`features`/`feature_states` (feature governance, O3).

**Devices (new)** — `devices` (device_id, profile_id, pubkey, app/config version, last_seen, status) for enrollment (F2) and config sync/fleet (D4/O3).

---

## 5. RLS strategy & JWT contract

- **JWT claims** (set by a Supabase auth hook, F2): `tenant_id`, `role`, `groups[]`.
- **Policy layers** (composed per table):
  1. **Tenant:** `tenant_id = (auth.jwt()->>'tenant_id')::uuid`.
  2. **Role:** writes gated by role (e.g. Editor+ can write content; Admin+ can write config); reads broad within tenant unless restricted.
  3. **Access-group:** documents/spaces filtered by membership via the `user_accessible_documents` logic (recursive group walk) — as an RLS `USING` clause or a security-definer helper.
- **Secrets:** `router_keys`, `tenant_keys` — **RLS denies all to anon/authenticated**; service-role only.
- **Service role:** bypasses RLS; C1 enforces tenant/role in code from the validated JWT.
- **Test:** a policy-coverage check asserts RLS is enabled + at least one policy exists on every tenant-scoped table; plus negative tests (cross-tenant read returns 0 rows).

---

## 6. Conventions

- `.ddl` file per object under `ddl/{schema}/table|view|function`, `set search_path` per file (existing pattern).
- UUID PKs (`gen_random_uuid()`), `tenant_id` first column on tenant tables, composite FK `(tenant_id, parent_id)` for in-tenant refs, `created_at`/`modified_at`/`modified_by`, `timestamptz` (revisit the old epoch-ms convention — standardize on `timestamptz`, decision 9d).
- Comments on every table (existing pattern is good — keep it).
- Embeddings stored as `vector(1024)` — central ingestion standardizes on one ~1024-dim cloud model; use `halfvec` if a >2000-dim model is later chosen (pgvector HNSW caps at 2000 dims); device-local embeddings use a separate index (different dim). Final model = C5.

---

## 7. dbd workflow (pre-v1, unchanged)

`dbd reset && dbd apply && dbd import` — drop/recreate, apply all DDL, load seed from `staging` + `import/loader.sql`. No migration files until v1 ships. (See memory `project_db_workflow`.)

---

## 8. Migration from current `database/`

1. Remove `partition by list (tenant_id)` + the partition trigger; keep `tenant_id` + composite FKs.
2. Enable RLS + add policies on every tenant table (§5); lock down `router_keys`/`tenant_keys`.
3. Add new tables (§3.3): roles (if #4), budget_nodes, spaces, document_collections/versions/assets, conversations/messages, audit_events, settings, devices.
4. Add columns: `model_endpoints.local_capable`, `fallback_chain_models.plane`, `gateway_tasks.execution_location`, `documents.space_id`.
5. Gate deferred tables behind decisions #1 (mcp), #3 (plans); drop `curator_conversations` in favor of `conversations/messages`.
6. Add a `service_role` auth-hook for JWT claims (coordinated with F2).
7. Reload seed; run the RLS coverage + cross-tenant negative tests.

---

## 9. Decisions for review (open)

- **9a. Isolation = RLS (not partitioning)?** — recommended (§3.1). Confirm.
- **9b. Embedding model / vector dim** — keep 384 (local fastembed/MiniLM) or go larger (cloud embeddings)? Ties to C5.
- **9c. Rename `public` → `app`?** — cosmetic; default keep `public` to minimize churn.
- **9d. Timestamps** — standardize on `timestamptz` (recommend) vs the old epoch-ms.
- **9e. Spaces vs access_groups** — model `spaces` as first-class with `access_groups` for membership (recommended), reconciling the old doc-access hierarchy.
- **Cross-refs to the 4 open product decisions:** #1 MCP tables, #3 plan tables (defer), #4 custom roles vs fixed enum (shapes the RBAC tables).

---

## 10. Done criteria

- `dbd reset && dbd apply && dbd import` runs clean on a fresh Supabase Postgres.
- RLS enabled with policies on every tenant-scoped table; `router_keys`/`tenant_keys` unreadable by `authenticated`.
- Seed catalog loads (providers/models/routers/capabilities/endpoints/chains/modules/features).
- Tests: RLS policy-coverage passes; cross-tenant read returns 0 rows; a non-member cannot read a confidential document.
- Schema documented (table comments) and reflected in dbdocs.

> **Next:** on approval, invoke writing-plans to produce the F1 implementation plan (DDL edits, RLS policies, seed updates, tests), then build via dbd.
