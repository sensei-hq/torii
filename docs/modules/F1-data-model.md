# F1 · Data model & schema

**Plane:** Foundations · **Status:** Planned · **Depends on:** none (root) · **Tooling:** dbd

## Purpose
The single multi-tenant Postgres schema every service reads and writes, managed and deployed with **dbd**. Adapts the existing [`database/`](../../database/) design.

## Responsibilities
- Per-tenant isolation, referential integrity, the seed catalog, and migrations.
- One source of truth for catalog (providers/models/routers) and runtime (tasks/logs) data.

## What we build
- **Tenant isolation via RLS** keyed on the Supabase JWT (`tenant_id` claim) — leaning to RLS + `tenant_id` columns rather than the old partition-per-tenant approach (simpler on Supabase).
- Entities (from `database/`, trimmed/extended):
  - **Identity:** `tenants`, `profiles`, `profile_tenants`, roles.
  - **Catalog:** `providers`, `models`, `routers`, `capabilities`, `model_endpoints`, `model_capabilities`.
  - **Routing:** `fallback_chains`, `fallback_chain_models` (+ per-space/role binding).
  - **Budgets:** org→dept→team→user tree with caps/period/spent.
  - **Vault:** `router_keys` (encrypted; RLS-locked, see F3).
  - **Knowledge:** `spaces`, `documents`, `document_embeddings` (pgvector), `access_groups`, collections/versions/lineage (new, per gap analysis §3d).
  - **Runtime:** `sessions`, `session_logs`, `gateway_tasks`, `gateway_task_logs`.
  - **Governance/UI:** `audit`, `settings`, `modules`/`features`/`feature_states`, `mcp_servers` (if X1).
- dbd pipeline: `dbd apply` (DDL) → seed import → migrations on release.

## Key contracts / data
- Composite FKs to keep references in-tenant; pgvector for embeddings; epoch-ms timestamps (carried from old design).

## UI surfaces
None (backend foundation).

## Reuse / source
`database/` (existing DDL, loader, seed) · `strategos_old/` design docs.

## Open questions
- RLS + `tenant_id` vs partition-per-tenant (lean RLS). 
- Embedding dimension (384 vs larger) — ties to C5 embedding-model choice.
- Custom roles vs fixed four (decision #4, see F2).
