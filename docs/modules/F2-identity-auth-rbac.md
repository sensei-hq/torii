# F2 · Identity, Auth & RBAC

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Foundations · **Status:** Planned · **Depends on:** F1

## Purpose

Who a caller is and what they may do — the basis for RLS and every authorization check.

## Responsibilities

- Authentication (Supabase Auth), JWT issuance with tenant + role claims, RBAC model, device enrollment.

## What we build

- **Supabase Auth**: email/OAuth for v1; **SSO/SAML** and **SCIM** directory sync as a fast-follow (the mockups assume Okta/Entra/Google/SAML).
- **JWT verification (RS256/JWKS)** — the gateway (C1) verifies Supabase JWTs with an asymmetric **verify-only** public key from the JWKS endpoint, **not** a shared HS256 secret (§2 W3). Asymmetric signing must be confirmed/enabled on the Supabase project.
- **JWT custom claims** (`tenant_id` + the resolved **capability set** / role-ids) injected by a Supabase `custom_access_token_hook` — consumed by RLS (F1) and the gateway (C1). The `groups[]` claim is **dropped/repurposed** (group-ACL retired, §3 / F1 RW9).
- **RBAC model = full role + permission matrix, not a fixed enum** (decision #4). `roles` (tenant-scoped; seeded defaults owner/admin/editor/viewer/member/service **+ custom**) × `role_permissions` (role × enumerated capability) × `profile_roles` (user↔role). This **replaces** the built fixed-six `profile_tenants.role` enum; RLS predicates and C1 authorize from **capabilities**, not the enum. One hierarchical tree (org→dept→team→user) drives both permissions and budgets. New Admin **permission-matrix** screen. Reconciles the three divergent mockup role vocabularies into this one model.
- **Device enrollment & lifecycle**: register a device public key, issue a **device-scoped token**, list/revoke devices (feeds D4 sync and O3 fleet). **Revocation is enforced on the hot path** — a per-request **device-status check** on the C1 proxy means a revoked device with a still-live JWT **cannot keep spending** (§2 apply-without-asking).

## Key contracts / data

- JWT claim shape; role→permission matrix; device record (`device_id`, pubkey, last_seen, app/config version, status).

## UI surfaces

- Sign-in (W1/W2), SSO/SCIM onboarding (W1), members & roles (W1), device management (O3).

## Reuse / source

Supabase Auth; Sensei's device/session patterns; `strategos_old` caller-context (tenant/user/role headers) → replaced by JWT claims.

## Resolved (by [`../DECISIONS.md`](../DECISIONS.md))

- **RBAC:** full role + permission matrix (custom roles supported), not a fixed four/six enum (decision #4).
- **JWT verification:** RS256/JWKS asymmetric verify-only (not HS256), §2 W3.

## Open questions

- SSO/SCIM in v1 or fast-follow (module leans fast-follow; not ratified in the decision record).
- Device attestation depth (keypair only vs OS attestation).
