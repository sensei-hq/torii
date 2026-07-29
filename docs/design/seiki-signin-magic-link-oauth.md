# Seiki sign-in: magic-link-primary + password + GitHub OAuth

**Date:** 2026-07-29 · **Status:** design approved, pending spec review · **Area:** `apps/admin` (Seiki web) · Phase-1a shell/auth
**Relates to:** [[docs/plans/phase-1a-shell-auth-plan.md]], DECISIONS.md (v1 sign-in = magic link + optional OAuth)

## Problem

The Seiki admin sign-in page (`src/routes/signin/+page.svelte`) offers only email+password, with no
register path and disabled Google/GitHub buttons. The ratified v1 decision is **magic link (passwordless)
+ optional OAuth**. We need to make magic link the primary sign-in, keep password as a secondary option,
wire the now-enabled GitHub OAuth, and give self-registering administrators a working path — while every
user must belong to a tenant.

## Key finding: the register backend already exists

`core.assign_tenant_by_domain()` is an **`AFTER INSERT ON auth.users` trigger** (RW2) that already:
1. Creates the `core.profiles` identity anchor for every new user.
2. Matches `split_part(NEW.email, '@', 2)` against `core.tenants.domain` (active tenants only).
3. On match: inserts `core.profile_tenants` (`assigned_by='domain_trigger'`) **and** the default **`member`**
   role into `core.profile_roles`.
4. Is `SECURITY DEFINER` and never raises (so it cannot 500 the signup).

`public.custom_access_token_hook` injects a `tenant_id` claim **only** when an active membership exists — so
an unmatched domain yields a signed-in but tenant-less user that the gateway rejects. **No schema or trigger
change is required**; this feature is frontend + UX riding the existing backend.

## Decisions (confirmed)

- **Shape:** magic link primary; password kept as a secondary, revealed option. Magic link doubles as the
  passwordless register path.
- **Register / tenant:** self-register is allowed; tenant is auto-derived from the email domain by the
  existing trigger; default role is **`member`** (admin elevation stays a separate action; self-registrants
  join an operator-created tenant, they do not create one).
- **Work-email enforcement:** **soft** — rely on the trigger. A matching domain auto-joins; an unrecognized
  or free-email domain yields a tenant-less session, and the app shows a clear "no organization" message.
  No free-email denylist to maintain.
- **GitHub OAuth:** enabled and wired, **best-effort + soft fallback**. It auto-joins only if GitHub's
  primary-verified email matches a tenant domain; otherwise the same "no-org — use your work email" message.
  **Magic link (typed work email) is the authoritative work-email/register path.**
- **Google:** stays `disabled` (not enabled in Supabase).
- **Identity linking:** **out of scope for v1** (fast-follow). Documented rationale below.

### Why GitHub is convenience-only (not a provisioning channel)

The tenant trigger runs once, on `auth.users` INSERT, reading `NEW.email`. GoTrue captures GitHub's
primary-verified email at first sign-up and keys the identity by GitHub's stable numeric id; subsequent
logins match by that id and do not refresh the stored email. So the signup email cannot be reliably
dictated through GitHub, and changing a GitHub primary email after signup has no effect. Making the typed
work email (magic link) authoritative avoids silent wrong-tenant assignment. Users whose GitHub primary is
personal should register via work-email magic link; **identity linking** (`supabase.auth.linkIdentity`) is
the robust way to later attach GitHub to that account — deferred to a fast-follow.

## Design

### Components (each isolated and independently testable)

| File | Change | Responsibility |
|---|---|---|
| `src/lib/auth-flow.ts` *(new, pure)* | `postAuthDestination(whoami \| error) -> 'home' \| 'no-org'`; `normalizeEmail`, `emailDomain` helpers | The only branchy logic; no framework/`$env` deps so it unit-tests under the existing node vitest setup |
| `src/lib/api.ts` | `+ signInWithMagicLink(email)`, `+ signInWithOAuth('github')` | Thin supabase-js wrappers. `emailRedirectTo`/`redirectTo = ${origin}/auth/callback`, `shouldCreateUser: true`. `signIn` (password) unchanged |
| `src/routes/auth/callback/+page.svelte` *(new)* | Await session (supabase `detectSessionInUrl`), resolve `whoami`, apply `postAuthDestination`: `goto('/')` or render the no-org state (with sign-out) | Single landing point for both magic-link and OAuth returns |
| `src/routes/signin/+page.svelte` | Magic-link-primary UI + "check your inbox" state; "Use a password instead" reveals the existing password field; GitHub button enabled; Google stays disabled | Presentation only; reads from `api` |
| `apps/admin/kavach.config.js` | Add `{ path: '/auth/callback', public: true }`; (optional) add `{ name: 'github', label: 'Continue with GitHub' }` to `providers` | Callback must not be auth-guarded |

### Flow

```
signin
  ├─ magic link:  api.signInWithMagicLink(email) → "check your inbox"
  └─ GitHub:      api.signInWithOAuth('github')
        → Supabase → (new user → assign_tenant_by_domain trigger) → redirect
              → /auth/callback
                    session established (detectSessionInUrl)
                    whoami:
                       tenant present → goto('/')
                       tenant-less    → render "no organization" + sign-out
```

### Error / edge handling
- **Tenant-less session** (unknown/free domain, or GitHub personal email): the callback renders a terminal
  "Your email domain isn't linked to an organization — ask your admin to add it" with a sign-out button.
  The callback route is exempt from the app's `onUnauthorized → /signin` bounce to avoid a redirect loop.
- **Magic-link send failure / OAuth error:** surfaced inline on the sign-in card (existing `error` pattern).
- **Expired/again:** re-sending a link is idempotent from the user's perspective.

## Non-goals (v1)
- Identity linking (GitHub ↔ work-email account) — fast-follow.
- Google OAuth — remains disabled until enabled in Supabase.
- Any schema / trigger / RLS change.
- A separate email+password "create account" form (magic link is the register path).

## Testing
- **Unit** (`src/lib/auth-flow.spec.ts`, node/pure — matches the existing convention): `postAuthDestination`
  returns `'home'` for a whoami with a tenant and `'no-org'` for a tenant-less/rejected result; `emailDomain`
  and `normalizeEmail` edge cases.
- **Manual browser-verify** of the real round-trips (magic-link email → callback → home; GitHub → callback;
  unrecognized domain → no-org), per the design-fidelity practice.
- **E2E** (Playwright) deferred — needs a real Supabase + inbox; tracked as a follow-up.

## Operator steps (not code — prerequisites for the flow to work end-to-end)
1. **Supabase → Auth → URL Configuration → Redirect URLs:** add `https://seiki.sensei-hq.com/auth/callback`
   and `http://localhost:5273/auth/callback` (dev).
2. **Populate `core.tenants.domain`** for the tenant(s) whose users should auto-join (e.g. `senecaglobal.com`).
   Without it, matching emails land in "no-org."

## To verify during implementation (not assumed)
- The gateway's `require_auth`/`/v1/whoami` behavior for a **tenant-less token** — whether it returns a clean
  "no tenant" signal or a hard 401 — so the callback distinguishes "no org" from a real auth error. A small
  gateway tweak may be needed; confirm before relying on it.
- A shared **`member`** role (`tenant_id NULL`, `key='member'`) is seeded so the trigger's role assignment
  succeeds.
- GoTrue's exact GitHub email-selection rule, confirmed against current Supabase docs.
