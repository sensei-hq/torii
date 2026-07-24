# F1 · Data model & schema

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Foundations · **Status:** **Built** in [`database/`](../../database/), now under a security + role-matrix **rework** — see [`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md) (RW1–RW13) · **Depends on:** none (root) · **Tooling:** dbd

## Purpose

The single multi-tenant Postgres schema every service reads and writes, managed and deployed with **dbd**. Adapts the existing [`database/`](../../database/) design.

## Responsibilities

- Per-tenant isolation, referential integrity, the seed catalog, and migrations.
- One source of truth for catalog (providers/models/routers) and runtime (tasks/logs) data.

## What we build

- **Tenant isolation via RLS** keyed on the Supabase JWT (`tenant_id` claim) — leaning to RLS + `tenant_id` columns rather than the old partition-per-tenant approach (simpler on Supabase).
- Entities (from `database/`, trimmed/extended — rework detail in [`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md)):
  - **Identity & RBAC:** `tenants`, `profiles`, `profile_tenants`; **full role + permission matrix** `roles` / `role_permissions` / `profile_roles` (decision #4) — this **replaces** the built fixed-six `profile_tenants.role` enum and reworks all RLS role predicates (RW2). One hierarchical tree (org→dept→team→user) drives **both** permissions and budgets.
  - **Programmatic access:** `api_keys` + `service_accounts` — a key **authenticates an identity** (person or `service_account`) with hashed secret + public prefix, capability scope, rate-limit, rotate/revoke, reveal-once. **No budget column on a key**; budget binds to the identity/node, resolved at execution (RW4).
  - **Catalog:** `providers`, `models`, `routers`, `capabilities`, `model_endpoints`, `model_capabilities` + per-tenant/space/role **override** tables (enable/pricing/verified, RW10).
  - **Routing:** `fallback_chains`, `fallback_chain_models` (+ per-space/role binding).
  - **Budgets:** org→dept→team→user tree with caps/period/spent; **hard-reserve** (reserve→commit) + cascade + `spent_amount` rollup, `service_role`-only; `budget_requests` (member increase → admin approval). Budget binds to **identity/node, never to a key or credential** (RW7, §2 W2).
  - **Credential vault:** `router_keys` generalized to **`router_credentials`** (`type = api_key | oauth`) — encrypted BYOK secret **or** OAuth account (access + refresh token, expiry, scopes, token_url); RLS deny-all, `service_role`-only, DEK/KEK envelope (RW13, see F3).
  - **Knowledge:** `spaces`, `documents`, `document_embeddings` (`vector(1024)`), collections/versions/lineage + `document_assets` (originals + normalized md/CSV/images), `documents.content_hash` (dedup) + `scope`/`owner_id` ownership. ACL = **space membership + fixed 4-level classification only**; the group-ACL (`access_groups`/`group_levels`/`document_access`/`user_accessible_documents`) is **retired** (RW9, §3). Collaborative-editing tables (comments/suggestions/`document_collaborators`) are **v2** (design-only in v1).
  - **Structured datasets (§3c):** queryable dataset + column schema with per-column sensitivity + field-level encryption for `sensitive`/`restricted` columns (compute-without-exposing).
  - **Ask persistence:** `conversations`, `messages`, `message_citations` (specced in F1, never built — added by RW5).
  - **Quality signals (§3b):** `quality_signals` store keyed to `inference_calls` / `messages` (explicit + implicit/system signals).
  - **Runtime & ledger:** `sessions`, `session_logs`; consolidate on the crate-native **`inference_calls`** as the single `service_role`-write ledger (budget source of truth + O1/O2 analytics) with org→dept→team→user attribution; **retire** `gateway_tasks` cost/metering duplication.
  - **Tools/MCP (§1, in v1):** `mcp_servers`, `tenant_mcp_servers`, per-(role×space) `tool_allow_lists`.
  - **Governance/UI:** `audit_events` (actor bound to `auth.uid()` or `service_role`-emitted), `settings`, `modules`/`features`/`feature_states` (gains `tenant_id` + RLS + 4-state + role/space scope, anon writes revoked), `user_preferences` (user layer of feature governance), alerts (`alert_rules`/`notification_channels`/`alert_events`), and a `service_role`-only redaction-mapping store if reversible W5 redaction is needed.
- **Write path (§2 W1):** privileged tables become `service_role`-write-only; web clients get `SELECT` + writes only on self-owned benign rows. Every privileged mutation goes through the gateway (or a thin authz API) enforcing the permission matrix server-side — no direct PostgREST writes to privileged tables.
- dbd pipeline: `dbd apply` (DDL) → seed import → **no migrations pre-v1** (`dbd reset && dbd apply && dbd import`); the RLS harness is extended with adversarial authz + budget-race tests (RW12).

## Key contracts / data

- Composite FKs to keep references in-tenant; pgvector for embeddings; epoch-ms timestamps (carried from old design).

## UI surfaces

None (backend foundation).

## Reuse / source

`database/` (existing DDL, loader, seed) · `strategos_old/` design docs.

## Resolved (by [`../DECISIONS.md`](../DECISIONS.md))

- **Tenant isolation:** RLS + `tenant_id` columns (not partition-per-tenant).
- **Embedding dimension:** `vector(1024)` — matches a crate-pullable 1024-dim model (e.g. `mxbai-embed-large` / `bge-large`); `similarity_search` re-declared `vector(1024)` (was `384`) and re-pointed at the space/classification ACL (RW10).
- **Roles:** full role + permission matrix (`roles`/`role_permissions`/`profile_roles`), not the fixed enum (decision #4, see F2).

## Open questions

- Exact shape of the org→dept→team→user attribution on `inference_calls` (denormalized columns vs a subject→node mapping) for the rollup path (RW7).
- Whether reversible W5 redaction is in scope for v1 (drives the `service_role`-only redaction-mapping store), or placeholder-only redaction suffices.
