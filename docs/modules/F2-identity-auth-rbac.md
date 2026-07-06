# F2 · Identity, Auth & RBAC

**Plane:** Foundations · **Status:** Planned · **Depends on:** F1

## Purpose

Who a caller is and what they may do — the basis for RLS and every authorization check.

## Responsibilities

- Authentication (Supabase Auth), JWT issuance with tenant + role claims, RBAC model, device enrollment.

## What we build

- **Supabase Auth**: email/OAuth for v1; **SSO/SAML** and **SCIM** directory sync as a fast-follow (the mockups assume Okta/Entra/Google/SAML).
- **JWT custom claims** (`tenant_id`, `role`, `groups`) via a Supabase auth hook — consumed by RLS (F1) and the gateway (C1).
- **RBAC model**: Owner / Admin / Editor / Viewer / Member / Service (custom roles pending, decision #4); a permission matrix mapping roles → capabilities.
- **Device enrollment**: register a device public key, issue a device-scoped token, list/revoke devices (feeds D4 sync and O3 fleet). Revoking a device cuts its access.

## Key contracts / data

- JWT claim shape; role→permission matrix; device record (`device_id`, pubkey, last_seen, app/config version, status).

## UI surfaces

- Sign-in (W1/W2), SSO/SCIM onboarding (W1), members & roles (W1), device management (O3).

## Reuse / source

Supabase Auth; Sensei's device/session patterns; `strategos_old` caller-context (tenant/user/role headers) → replaced by JWT claims.

## Open questions

- SSO/SCIM in v1 or fast-follow.
- Custom roles vs fixed four (decision #4).
- Device attestation depth (keypair only vs OS attestation).
