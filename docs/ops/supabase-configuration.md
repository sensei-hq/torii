# Supabase configuration — torii + seiki

**One hosted Supabase project** backs the whole product suite. The **Seiki** web SaaS and
the **Torii** desktop app are both *clients* of it; the **torii-gateway** verifies its JWTs.
`localhost` Supabase is **dev-only** — production desktop installs connect to the *same
hosted URL* as the web app, over the internet. This suite's Supabase is **separate from
sensei-dojo's** (cross-product isolation — see `DECISIONS.md §8`).

> The Supabase URL is **not** the web-app URL. `seiki.sensei-hq.com` is the Seiki portal;
> Supabase lives at `https://<ref>.supabase.co` (or a custom domain). Every client's
> `PUBLIC_SUPABASE_URL` points at the **Supabase** URL, never at `seiki.sensei-hq.com`.

---

## 0. Environments at a glance

| | `PUBLIC_SUPABASE_URL` (web + desktop) | `PUBLIC_GATEWAY_URL` |
|---|---|---|
| **Local dev** | `http://127.0.0.1:55321` | `http://127.0.0.1:8787` |
| **Production** | `https://<ref>.supabase.co` | `https://api.torii.sensei-hq.com` |

The anon (publishable) key ships to browsers **and** is baked into the desktop binary —
it is public by design. Security is RLS + the gateway + JWT verification, never client
trust.

---

## 1. Create the project

1. Supabase dashboard → **New project** → name `seiki-prod` (this project serves both torii
   + seiki). Pick a region near your users + the gateway host.
2. Save the **Project URL** (`https://<ref>.supabase.co`) and the **publishable (anon) key**
   and the **service key** (secret — server-side only).

## 2. JWT signing — RS256 / asymmetric (build gate, DECISIONS W3)

The gateway verifies tokens with a **verify-only public key** from JWKS, never a shared
HS256 secret.

1. **Settings → JWT Keys** (or Auth → Signing Keys) → enable **asymmetric (RS256/ES256)**
   signing. Confirm `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` returns keys.
2. The gateway reads that JWKS at boot + refetches on `kid` miss. No secret needed.
   (`SUPABASE_JWT_SECRET` is only a legacy HS256 fallback — leave it unset in prod.)

## 3. Auth → URL Configuration (redirects)

Only needed for **magic-link / OAuth** (email+password needs none).

- **Site URL:** `https://seiki.sensei-hq.com`
- **Redirect URLs (allow-list):**
  - `https://seiki.sensei-hq.com/**`
  - `torii://auth-callback` — the desktop deep link (native apps have no web server)
  - `http://localhost:5273/**`, `http://localhost:5274/**` — dev
- Enable providers you want under **Auth → Providers** (Google, GitHub…). Native OAuth
  should use the **PKCE** flow (`flowType: 'pkce'` on the desktop client).

## 4. Multi-tenant claims — `custom_access_token_hook`

One `auth.users`; tenant isolation is RLS + a claims hook that stamps each JWT with
`tenant_id`, `role_ids`, `claims_version` (the downgrade-revocation gate, DECISIONS §2).

1. **Auth → Hooks → Custom Access Token** → enable, point at the hook function
   (`core`/`public` schema function that reads the user's active tenant + roles).
2. The gateway resolves *capabilities* server-side from `role_ids` — never trusts them from
   the token — and rejects a token whose `claims_version` is stale.

## 5. Schema + RLS

Apply the schema-as-code with the DB workflow (pre-v1): `dbd reset && dbd apply && dbd
import && dbd policies`. RLS coverage + isolation are enforced and tested — run
`DATABASE_URL=<prod-or-local> database/tests/run.sh` (must print `ALL DB SECURITY TESTS
PASSED`).

> **Never** point `dbd reset` at a DB with real data. For prod, apply the DDL/policies
> to a fresh project once, then use forward migrations.

## 6. Gateway → Postgres

The gateway holds a **connection pool** (sqlx), so give it the **direct** connection
string or the **session-mode** pooler (port `5432`), not the transaction pooler:

```
DATABASE_URL=postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require
```

`Settings → Database → Connection string` has both. Keep this **secret** (it is the
service-level DB credential).

## 7. Wire the clients

- **Seiki web (`apps/admin`)** → Cloudflare secrets `PUBLIC_SUPABASE_URL`,
  `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_GATEWAY_URL`.
- **Torii desktop (`apps/desktop`)** → injected at build time into the release env
  (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_GATEWAY_URL`). The tracked
  `.env` currently points at a dead project — replace it with the hosted values or move to
  a build-time secret. Local dev uses the gitignored `apps/desktop/.env.local`.
- **Gateway** → `DATABASE_URL`, `PUBLIC_SUPABASE_URL`, `TORII_KEK`, provider BYOK keys —
  set as host secrets (see `docs/ops/deployment.md`).

## 8. Verify

- `curl https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` → returns keys.
- Sign in on web + desktop → both mint a JWT from the same project.
- Gateway logs `JWKS: loaded N key(s)` at boot; an authed `/v1/whoami` returns your
  `tenant_id` + capabilities.
