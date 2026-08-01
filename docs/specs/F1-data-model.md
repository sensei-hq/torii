# F1 · Data model & schema — Spec

**Module:** [F1](../modules/F1-data-model.md) · **Status:** Built (2026-06) — **REWORK REQUIRED** · **Depends on:** none (root) · **Enables:** F2, F3, C1–C5, O1–O3
**Date:** 2026-06-18 · **Reworked:** 2026-07-23 · **Tooling:** dbd · **Engine:** PostgreSQL (Supabase) + `vector`

---

> ⚠️ **Rework banner (2026-07-23).** The v1 schema was BUILT under superseded assumptions (fixed-role enum; MCP/API-key/agent tables deferred; client-writable privileged tables). Per [`../DECISIONS.md`](../DECISIONS.md) it must be reworked. Substantive changes, all detailed in [`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md):
> 1. **Full role + permission matrix** (`roles`/`role_permissions`/`profile_roles`) replacing the `profile_tenants.role` enum; one hierarchical tree drives permissions **and** budgets.
> 2. **Gateway-mediated writes** — privileged tables become `service_role`-write-only (closing the current privilege-escalation, budget-bypass, and confidentiality holes; web clients get `SELECT` + self-owned benign writes only).
> 3. **Hard budget reserve** on hard-cap nodes + consolidation onto one `service_role`-only ledger (`inference_calls`); cascade + rollup enforced, not prose.
> 4. **MCP** (`mcp_servers`/`tenant_mcp_servers`/tool-allow-list) and **API keys** (`api_keys`/`service_accounts`) into the v1 cut.
> 5. **`conversations`/`messages`/`message_citations`** (specced but never built) added for Ask.
> 6. **Retire** the group-ACL tables (`access_groups`/`group_levels`/`document_access`/`user_accessible_documents`) — v1 doc access = space membership + fixed 4-level classification only.
> 7. **Fixes:** `similarity_search` → `vector(1024)`; config-catalog + `core.tenants` client read grants; `feature_states` → `tenant_id`+RLS+4-state, anon revoked; `audit_events` actor binding; `devices` last_seen/buffer-health; default-space/budget seed; add `user_preferences`, `prompt_templates`, `budget_requests`, alerts, and per-tenant catalog overrides.
>
> Sections below are updated to the ratified target; the "open decisions" in §9 are resolved.

---

## 1. Purpose & scope

Define the single multi-tenant Postgres schema that every Torii service reads and writes, the **tenant-isolation model**, and the **v1 table cut**. This spec adapts the existing [`database/`](../../database/) design (built for the old hosted product) to the split-plane SaaS: web clients hit **Supabase PostgREST under RLS**; the **central gateway uses the service role** and scopes by JWT; the desktop app pulls a config snapshot (no secrets).

Out of scope here: per-table column-by-column DDL (that's the implementation plan), and the engine config mapping (C1/C2).

---

## 2. Current state (what `database/` already has)

- **Schemas:** `core` (tenants, profile_tenants, tenant_keys, tenant_languages), `config` (providers, models, routers, capabilities, model_endpoints, model_capabilities, modules, features, feature_states, mcp_servers), `public` (router_keys, fallback_chains/models, gateway_tasks/logs, sessions/logs, documents, document_embeddings, access_groups/group_levels/_lang, document_access, profile_groups, curator_conversations, plans/planned_tasks/interactions, tenant_mcp_servers), `history` (past_*), `staging`, `extensions`.
- **Isolation:** `public` tables are `partition by list (tenant_id)`; a trigger creates per-tenant partitions on tenant insert. Composite FKs `(tenant_id, …)` keep references in-tenant.
- **Crypto:** `core.tenant_keys` (per-tenant DEK), `public.router_keys.encrypted_api_key` (AES-256-GCM `[IV][tag][ciphertext]`).
- **Views:** `effective_chain_models`, `viable_chain_models`, `user_accessible_documents`, `user_accessible_sessions`.
- **dbd:** `.ddl` files per object, `set search_path` per file, seed via `staging` + `import/loader.sql`; grants in `design.yaml` (anon/authenticated = usage+select on `config`/`public`; service_role = all).
- **Embeddings:** `document_embeddings.embedding vector(1024)`, HNSW index. _(Note: the legacy pre-build design used 384; the built column is 1024, but `similarity_search` is wrongly still declared `vector(384)` — fixed in the rework, §9/RW10.)_

---

## 3. Target for v1 — key decisions

### 3.1 Isolation: **RLS, not partition-per-tenant** _(decided ✓ 2026-06-18)_

Drop list-partitioning; isolate with **Row-Level Security** keyed on the Supabase JWT (`tenant_id` claim), keeping `tenant_id` columns + composite FKs for integrity.

- **Why:** partition-per-tenant means thousands of partitions + a DDL trigger per signup — heavy ops on managed Postgres, and Supabase RLS is the idiomatic, well-supported path. RLS also lets web clients use PostgREST directly (less custom API).
- **How:** every tenant-scoped table gets an RLS policy `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid`, composed with role/visibility predicates (§5). The **service role bypasses RLS** — the central gateway (C1) does explicit tenant scoping in code. The existing access views become RLS policies (or stay as views queried under RLS).
- **Cost/risk:** RLS correctness must be tested (a missing policy = a leak). We add a policy-coverage test that fails if any tenant table lacks an enabled policy.

### 3.2 Schema organization (keep, lightly adjusted)

- `core` — tenancy + identity bridge (service_role only).
- `config` — shared catalog + platform-managed reference (readable under RLS).
- `app` — _(renamed from `public`)_ per-tenant runtime + content. _(Optional rename; `public` works too — decision 9c.)_
- `audit` — **new**: append-only governance/audit events (O1).
- `history` — change historization (keep as-is for feature/mcp history).
- `staging`, `extensions` — unchanged.

### 3.3 v1 entity cut

| Bucket                               | Tables                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reuse as-is (minus partitioning)** | tenants, profile_tenants, tenant_keys, tenant_languages, providers, models, routers, capabilities, model_endpoints, model_capabilities, fallback_chains, fallback_chain_models, router_keys, sessions, session_logs, gateway_tasks, gateway_task_logs, documents, document_embeddings, access_groups, group_levels, *_lang, document_access, profile_groups, modules, features, feature_states                                           |
| **New (this spec adds)**             | **budget_nodes** (org→dept→team→user tree; period / hard-soft / alert threshold / free-floor), **spaces** (first-class), **document_collections / document_versions / document_assets** (doc mgmt §3d), **conversations / messages / message_citations** (Ask threads, replaces curator), **audit_events**, **settings** (workspace + space scope), **devices** (enrollment, F2/D4). |
| **New — added in the 2026-07-23 rework** | **roles / role_permissions / profile_roles** (full permission matrix — §4 RBAC); **mcp_servers / tenant_mcp_servers / tool_allow_lists** (X1, in v1); **api_keys / service_accounts** (programmatic access, owned by Organization); **user_preferences** (feature-gov user layer); **prompt_templates**; **budget_requests** (member increase-request/approval); **alert_rules / notification_channels / alert_events**; per-tenant **catalog override** tables (Models per-tenant/space/role enable + pricing); `inference_calls` as the single `service_role`-only ledger; **`router_credentials`** (generalizes `router_keys` → `type api_key\|oauth` + encrypted OAuth access/refresh/expiry/scopes); **`core.profiles`** (+`claims_version bigint`); **`budget_holds`** (reserve→commit ledger; +`budget_nodes.reserved_amount/period_started_at/soft_overshoot_limit`, +`inference_calls` attribution/`execution_location`/`hold_id` — C3 §3.1 canonical shape); **`quality_signals`** (interaction intelligence, C6); **`chain_bindings` / `routing_policies` / `provider_health`** (routing, C2); **`mcp_server_tools`** (per-server tool catalog); **`config.config_versions`** (config snapshot versioning); **`model_overrides` / `provider_overrides`** (per-tenant catalog overrides); **`structured_datasets` / `dataset_columns`** (sensitive structured data, §3c); **O2 rollup tables** (usage/cost aggregation). See [`../DECISIONS.md`](../DECISIONS.md) §5 for the canonical full table set. |
| **Deferred (post-v1)**               | plans, planned_tasks, planned_task_interactions → **X2** agent/plan **runtime** (design-only screens ship in v1, no runtime tables). curator_conversations → **replaced** by conversations/messages (§4 Knowledge). |
| **Retired (removed in rework)**      | `access_groups`, `group_levels`, `*_lang`, `document_access`, `profile_groups`, `user_accessible_documents` (group-ACL — v1 doc access = space membership + classification only, §5); `gateway_tasks` cost/metering fields (superseded by `inference_calls`). |

---

## 4. Entities by domain (v1)

**Identity & tenancy** — `tenants`, `profile_tenants` (user↔tenant + **role**), `tenant_keys`, `tenant_languages`. JWT carries `tenant_id`, `role_ids[]`, `claims_version` (+ optional `device_id`); capabilities are resolved **server-side** from `role_ids[]` + the permission matrix — the JWT carries **no** role-enum claim and **no** `groups[]` claim. The JWT contract is owned by **F2 §4.1** (cross-reference).

**RBAC** — **full role + permission matrix** (decision #4, ratified 2026-07-23): `roles` (per-tenant, seeded with sensible defaults + custom), `role_permissions` (role × granular capability grant), `profile_roles` (user↔role, tenant-scoped). A single hierarchical tree (org→dept→team→user, shared with the budget/`budget_nodes` structure) drives **both permissions and budget cascade**. The JWT claims hook injects the resolved capability set (or role ids) so RLS + C1 authorize from claims. This **replaces** the built `profile_tenants.role` enum; all RLS role predicates and the JWT hook are reworked accordingly. A new Admin permission-matrix screen (W1) manages it. `space_members.role` stays as an informational per-space label.

**Catalog** — `providers`, `models`, `routers`, `capabilities`, `model_endpoints`, `model_capabilities`. Platform-tenant-owned defaults, tenant-overridable. Add `model_endpoints.local_capable` flag (for the split-plane / D3).

**Routing** — `fallback_chains`, `fallback_chain_models` (+ **per-step plane** flag `local|cloud`, C2) + space/role binding. Keep `effective_chain_models` / `viable_chain_models` resolution as views.

**Budgets (new)** — `budget_nodes` (self-referential tree: org→dept→team→user, `cap`, `period D|W|M`, `hard|soft`, `alert_threshold`, `free_floor_enabled`, `spent` rollup), mapped onto people/teams/depts. **Enforced in the central gateway with a synchronous reserve→commit on `hard` nodes** (a call is admitted only if every ancestor has headroom; `soft` nodes allow bounded overshoot + alert). Metered from the single `service_role`-only ledger **`inference_calls`** (not the client-writable `gateway_tasks`); the cascade + `spent` rollup are enforced by a DB function/trigger + the gateway, never left to prose. Budget **binds to the caller's identity/node** (person or service account) and is resolved at execution — **never to a key or provider credential**. `budget_requests` holds member increase requests + admin approval. See [`../DECISIONS.md`](../DECISIONS.md) §2 (W2).

**Credential vault** — `tenant_keys` + **`router_credentials`** (generalizes the built `router_keys`): each row is `type = api_key | oauth`. `api_key` stores the encrypted BYOK secret; `oauth` stores encrypted access **and refresh** tokens + `expires_at` + `scopes` + `token_url` (for Anthropic-style OAuth provider accounts). All encrypted (DEK/KEK envelope), RLS-locked — **no client SELECT**; only the service role decrypts in C1/F3. OAuth credentials are **auto-refreshed before expiry** by an F3/central background refresher; the cloud adapter accepts a bearer credential (verify/enhance `sensei-cloud-providers` — tracked as a gateway issue). At-rest custody is already correct (deny-all RLS + `service_role`-only + AES-256-GCM). Per [`../DECISIONS.md`](../DECISIONS.md) §2 (W4): the **F3 vault must land before C1 handles any real provider credential** (no plaintext-env phase deploys); the production KEK lives in a cloud **KMS/HSM** (`TORII_KEK` env var is local-dev only).

**Programmatic access** — `api_keys` (authenticate an **identity** — a person or a `service_account`; hashed secret + prefix, capability scope, rate-limit, rotate/revoke, reveal-once) + `service_accounts`. **Keys carry no budget** — budget follows the caller's identity in the hierarchy and is enforced at execution (see Budgets above / DECISIONS §2 W2). A `service_account` is a node in the org tree (`budget_nodes.kind='service'`).

**Knowledge** — `spaces` (new first-class: name, classification, owner, members via `space_members`), `documents` (+ `space_id`, status), `document_collections`, `document_versions`, `document_assets` (extracted md/csv/images in Storage), `document_embeddings` (`vector(1024)`), and **`conversations`/`messages`/`message_citations`** (replaces `curator_conversations`; Ask threads with citations). Doc ACL = **`space_members` + fixed 4-level classification** only; the recursive group-ACL (`access_groups`/`group_levels`/`document_access`/`profile_groups`) is **retired** (see §5, RW9).

**Runtime** — `sessions`, `session_logs`, `gateway_tasks`, `gateway_task_logs` (+ **execution_location** `local|cloud` for the split-plane ledger, O1).

**Governance** — `audit_events` (new, append-only; O1), `settings` (new; workspace + space scope = the 3-level control model), `modules`/`features`/`feature_states` (feature governance, O3).

**Devices (new)** — `devices` (device_id, profile_id, pubkey, app/config version, last_seen, status) for enrollment (F2) and config sync/fleet (D4/O3).

---

## 5. RLS strategy & JWT contract

- **JWT verification:** the central gateway verifies Supabase JWTs via **RS256/JWKS** (verify-only public key), not a shared HS256 secret — a config leak cannot forge tokens (DECISIONS §2 W3).
- **JWT claims** (set by a Supabase auth hook, F2): `tenant_id`, `role_ids[]`, `claims_version` (`i64`/`bigint`), and optional `device_id`. **No** role-enum claim and **no** `groups[]` claim; capabilities are resolved **server-side** from `role_ids[]` against the F2 §4.3 closed capability set. The JWT contract is owned by **F2 §4.1** (cross-reference).
- **Write authority (gateway-mediated — DECISIONS §2 W1).** Privileged tables — `profile_tenants`, `profile_roles`/`roles`/`role_permissions`, `budget_nodes`, `fallback_chains`/`fallback_chain_models`, `spaces`/`space_members`, `documents.classification`, `settings`, governance/feature tables, catalog overrides — are **`service_role`-write-only**. Web clients get `SELECT` (tenant-scoped) + write access **only** to clearly self-owned benign rows (own draft docs, own `user_preferences`). All privileged mutations flow through the central gateway / a thin authz API that checks the capability matrix server-side. *(This closes the built holes: role self-escalation, self budget-raise, confidential-space self-join, classification downgrade.)*
- **Policy layers** (composed per table):
  1. **Tenant:** `tenant_id = (auth.jwt()->>'tenant_id')::uuid` on every tenant-scoped table.
  2. **Read-role:** SELECT visibility narrowed by capability where needed; broad within tenant otherwise.
  3. **Classification:** documents/spaces filtered by **space membership + fixed 4-level classification** (public/internal → tenant members; confidential → space members; restricted → doc/space owner). The recursive **group-ACL is retired** (`access_groups`/`group_levels`/`document_access`/`profile_groups`/`user_accessible_documents` removed).
- **Secrets:** `router_keys`, `tenant_keys` — **RLS denies all to anon/authenticated**; service-role only (already correct — keep).
- **Audit integrity:** `audit_events` INSERT binds `actor_id = auth.uid()` (or is `service_role`-only, gateway-emitted); UPDATE/DELETE denied. `config.feature_states` gains `tenant_id` + RLS and **revokes anon writes**.
- **Service role:** bypasses RLS; C1 enforces tenant + capability in code from the validated JWT, and does the budget reserve.
- **Test:** policy-coverage (RLS enabled + ≥1 policy on every tenant table) **plus authz negative tests** — a non-privileged member cannot escalate role, raise a budget, join a confidential space, declassify a doc, or forge an audit row; cross-tenant read returns 0 rows; concurrent calls cannot race past a `hard` cap.

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

## 9. Decisions (RESOLVED — see [`../DECISIONS.md`](../DECISIONS.md))

- **9a. Isolation = RLS (not partitioning)** — ✅ decided & built.
- **9b. Embedding dim = `vector(1024)`** — ✅ final. Central cloud + on-device (embedded-Ollama, e.g. `mxbai-embed-large`/`bge-large`) both emit 1024. **Fix:** `similarity_search` is wrongly declared `vector(384)` — correct to 1024.
- **9c. Keep `public`** (no rename) — ✅.
- **9d. `timestamptz`** — ✅ standardized.
- **9e. Doc access = space membership + fixed 4-level classification only** — ✅. The group-ACL (`access_groups`/`group_levels`/`document_access`/`profile_groups`) is **retired**.
- **Product decisions #1–#4** — all resolved: **#1 MCP in v1** (tables + allow-lists); **#2 API keys in v1** (owned by Organization); **#3 agents design-only** (no runtime tables); **#4 full role + permission matrix** (`roles`/`role_permissions`/`profile_roles`, replacing the enum).
- **Security posture** (DECISIONS §2): gateway-mediated privileged writes · hard budget reserve · RS256/JWKS · F3-before-real-keys + KMS KEK · audit actor-binding · `feature_states` lockdown.

---

## 10. Done criteria

- `dbd reset && dbd apply && dbd import` runs clean on a fresh Supabase Postgres.
- RLS enabled with policies on every tenant-scoped table; `router_keys`/`tenant_keys` unreadable by `authenticated`.
- Seed catalog loads (providers/models/routers/capabilities/endpoints/chains/modules/features).
- Tests: RLS policy-coverage passes; cross-tenant read returns 0 rows; a non-member cannot read a confidential document.
- Schema documented (table comments) and reflected in dbdocs.

> **Next:** on approval, invoke writing-plans to produce the F1 implementation plan (DDL edits, RLS policies, seed updates, tests), then build via dbd.
