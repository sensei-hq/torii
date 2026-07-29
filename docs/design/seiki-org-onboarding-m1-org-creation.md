# Seiki self-service onboarding — M1: org creation + ownership

**Date:** 2026-07-29 · **Status:** design approved, pending spec review · **Area:** `apps/admin` (Seiki web) + `services/gateway` + `database`
**Part of:** self-service onboarding (M1 of 2). **M2** (domain claim + request-to-join/approval) builds on this and is a separate spec.
**Builds on:** the shipped magic-link sign-in (`docs/design/seiki-signin-magic-link-oauth.md`). **Supersedes** its "no-org" dead-end with a Create-organization onboarding.

## Problem

Today a tenant is created only by an operator hand-editing `core.tenants` in SQL, and the `owner`/`admin` roles — though seeded — carry **no capabilities**, so even a placed owner is 403'd everywhere. We need a signed-in, tenant-less user to **self-create an organization**, become its **owner**, and be able to **transfer ownership** — with `owner`/`admin` granted the right capabilities. No domain machinery yet (that's M2).

## Grounding facts (verified)

- **One tenant per user:** `core.profile_tenants.profile_id` is the PRIMARY KEY. Org-creation is therefore reachable only by tenant-less users and is inherently single-membership.
- **New tenants need a budget org-root:** the C1 budget hot-path (`services/gateway/src/budgets.rs`) resolves the tenant's `kind='org'` root (`parent_id is null`) and is **fail-closed** — without it every chat request for that tenant is rejected. `orgs/create` must seed it.
- **Capability vocabulary already exists** (27 keys in `database/import/staging/rbac_capabilities.jsonl`) and the `/rpc` handlers enforce them via a `require(<cap>)` wrapper resolving `core.effective_role_permissions`. **Only `editor`/`viewer`/`member`/`service` have grants** — `owner`/`admin` have none.
- **JWT claims** are stamped by `custom_access_token_hook` from `profile_tenants` + `profile_roles` at token issuance; a token minted while tenant-less carries no `tenant_id`.
- Privileged writes go through the gateway `/rpc` (service-role), never the client or the signup trigger (DECISIONS §5a).

## Decisions (confirmed)

- **Onboarding = explicit "Create organization"** for tenant-less users. (M2 adds the "request to join a claimed domain" branch.)
- **Creator → `owner`** (singular per tenant, transferable). Promotion/demotion of `admin`s reuses the existing `role.manage`-gated `assign-role`/`unassign-role` RPCs.
- **`owner`/`admin` capability grants** (shared defaults, `tenant_id NULL`, resolved via `core.effective_role_permissions`):
  - `owner` → all 27 capabilities.
  - `admin` → all except **`tenant.manage`**, **`role.manage`**, **`apikey.manage`** (24). Keeps `member.manage`, budgets, routing, `connection.manage`, `model.manage`, `mcp.manage`, `governance.manage`, `feature.manage`, `device.manage`, `audit.read/export`, `analytics.read`, and all knowledge caps.
- **Transfer/delete-org are NOT capabilities** — they are gated on the caller holding the singular `owner` role.

## Design

### Backend — schema/seed (`database/`)
- **Seed `owner`/`admin` role_permissions** in `database/import/staging/role_permissions.jsonl` (the two grant sets above), imported as shared defaults via the existing `import_role_permissions` procedure.
- **Owner-singularity backstop:** a partial unique index ensuring at most one active `owner` per tenant in `core.profile_roles` (the RPC also enforces it in-transaction).
- No new tables in M1.

### Backend — gateway `/rpc` (`services/gateway/src/routes/rpc.rs` + route in `main.rs`)
- **`orgs/create`** — auth'd, no capability gate (any tenant-less caller); **rejects if the caller already has a tenant** (single-membership). One transaction:
  1. `insert core.tenants` (name; unique `slug` derived from name; `status='trial'`; `modified_by=caller`).
  2. `insert core.profile_tenants` (caller → new tenant, `active=true`, `assigned_by='self_create'`).
  3. `insert core.profile_roles` (caller → `owner`).
  4. `insert public.budget_nodes` org root (`kind='org'`, `parent_id=null`, sensible default cap/period).
  5. bump `core.profiles.claims_version`.
  Returns `{ tenant_id }`. Writes an `audit_events` row.
- **`orgs/transfer-ownership`** — auth'd, **owner-role-gated** (not a capability): verify caller currently holds `owner` for their tenant and the target is an active member; then in one transaction demote caller `owner→admin`, promote target `member/admin→owner`, bump both `claims_version`, write `audit_events`. Enforces exactly-one-owner.

### Frontend (`apps/admin`)
- **Onboarding** (tenant-less users): the sign-in callback's `no-org` branch now routes to a **Create organization** screen (name input → `api.createOrg(name)`). On success the client **`supabase.auth.refreshSession()`** so the new `tenant_id`/`role_ids` land in the JWT, then navigates to `/`.
- **Organization screen**: a **Transfer ownership** action (owner-only, select a member → confirm → `api.transferOwnership(profileId)` → refresh). Promote/demote members to `admin` via the existing role RPCs.
- **`api.ts`**: `createOrg(name)` → `/rpc/orgs/create`; `transferOwnership(profileId)` → `/rpc/orgs/transfer-ownership`.

### Data flow
`signin → /auth/callback → tenant-less → /onboarding → createOrg → refreshSession → /` (now a full member/owner of the new tenant). Transfer: Organization screen → transferOwnership → refreshSession (former owner's caps change).

### Error handling
- `orgs/create` when the caller already has a tenant → 409-style error surfaced on the onboarding screen.
- Slug collision → the RPC de-dupes (`-2`, `-3`, …) server-side.
- Transfer by a non-owner, or to a non-member → 403 / validation error, surfaced on the Organization screen.

## Testing
- **Unit (pure):** slug derivation/dedupe helper (`apps/admin` or gateway-side — wherever slugging lives), node vitest.
- **DB/gateway:** extend `database/tests/authz.sql`-style coverage — a fresh `orgs/create` yields owner with the 27 caps resolving through `effective_role_permissions`, an org-root budget node exists, and a second `orgs/create` by the same profile is rejected; `transfer-ownership` moves the single owner and is refused for non-owners. Rust handler tests mirror the existing `/rpc` test pattern.
- **Manual browser-verify:** create-org from a tenant-less session → lands on `/` as owner with a working shell; transfer ownership round-trip.

## Non-goals (M1)
Domain claiming, free-email denylist, request-to-join/approval, and simplifying `assign_tenant_by_domain` — all **M2**. Multi-org membership per user (schema is single-tenant). DNS domain verification.

## To verify during implementation
- The exact `require(<cap>)` signature + how `orgs/create` opts out of a capability gate (auth-only) — read `rpc.rs:35-56`.
- The `budget_nodes` org-root default `cap_amount`/`period`/`enforcement` appropriate for a new trial org (mirror `seed_rework.sql`).
- Whether any existing code assumes exactly-one-tenant-per-user in a way the new flow must respect.
