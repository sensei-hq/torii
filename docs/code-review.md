# Code Review — Torii monorepo

Reviewer: opencode · 2026-07-31
Baseline: `docs/DECISIONS.md` (ratified 2026-07-23) as the authoritative spec.
Scope: `services/gateway` (Rust), `database/`, `apps/admin`, `apps/desktop` (Tauri), `packages/ui`, `packages/core`, build/CI.
Method: direct file review + two parallel agent reviews + independent verification of every claim cited below.

---

## Verdict

The security-critical backend and the entire database authz layer are in genuinely good shape — fail-closed, adversarial-tested, spec-aligned. The **desktop member console** carries the serious issues: it shipped email+password only (originally flagged as the rejected design — since **RESOLVED by the 2026-07-31 amendment**, which blesses email+password as a secondary; the residual is that desktop still lacks the *primary* magic-link path), two of its routes are unreachable behind the auth guard, and its "cloud" plane is effectively defaulted off. The **repo gates are red at head** (`make test`, `make check`), and no JS test/type gate runs in CI. Most admin/app surface is honest and aligned.

---

## Resolution status (2026-07-31)

All findings addressed. Commits are local on `develop` (per-finding).

| # | Status | Commit | Note |
| --- | --- | --- | --- |
| H1 | ✅ fixed | `596a64d` | core: inline @kavach in vitest + tsconfig `paths` shim → `bun run test`/`check` green; new `js.yml` CI gate (core/ui/admin). |
| H2 | ✅ amended + partly built | `e9cda5e`, `acf560f` | DECISIONS §10.2 amended (email+password is a blessed secondary); desktop now ships magic-link (OTP) primary + password reset. |
| H3 | ✅ fixed | `6e3555b` | desktop guard allowlist DERIVED from the route tree (`deriveGuardRules` + 4 unit tests + e2e nav sweep) → /compare + /models reachable. |
| M1 | ✅ fixed | `697148f` | desktop cloud plane requests the real `chat` chain (was `local`); demo routing no longer baked into `lib/`. |
| M2 | ✅ fixed | `3b8f7b8` | e2e seams consolidated behind one prod-dead `IS_E2E` gate (route-intercept N/A for Tauri IPC infer). |
| M3 | ✅ fixed | `8080373` | dropped the fabricated `eu-west-2` badge; region only shown when the gateway provides it. |
| M4 | ✅ fixed | `edb4d32` | Overview degrades per-read (partial-data note) instead of blanking on one failure. |
| L1 | ✅ fixed | (this commit) | `~/.strategos/models` → `~/.torii/models` with a one-time migration; Makefile header + README; `strategos://` comment retired. Tauri id was already `dev.torii.app`. |
| L2 | ✅ folds into H1 | `596a64d` | `make test`/`check` were red only because of H1; now green. |

Since resolved (2026-07-31, "umbrella is torii" — no strategos in code/config/docs): the `STRATEGOS_*` env fallbacks were removed (TORII_* only), the doc-prose sweep landed (Strategos→Torii for engine/gateway, →Seiki for admin/web-SaaS), and the local-DB rebrand (project_id + `owner2@torii.local` seed) was done at a coordinated reset. Kept intentionally: the mockups' `StrategosUI`/`StrategosAPI` functional identifiers (design reference) + the byte-identical `uploads/Strategos-2` backup. Upstream: republish `@kavach/*` with `dist/` + extension-ful imports ([jerrythomas/kavach#25](https://github.com/jerrythomas/kavach/issues/25)) to retire the core shim.

---

## High

### H1 — Repo gates are red at head: `bun run test` and `bun run check` both fail

The dependency `@kavach/sentry@1.0.0` is published broken, which breaks two repo-wide gates:

- `packages/core` **tests fail**:
  `src/auth/auth.spec.ts` → `Error: Cannot find module '…/@kavach/sentry/src/types'` imported from `src/index.js`. The tarball ships `src/types.js` (not `types.ts`), and `index.js` does `export * from './types'` — an extensionless relative import that fails under ESM resolution.
- `packages/core` **typecheck fails** (exit 2), 4× `TS7016 Could not find a declaration file` — including `src/auth/guard.ts` importing `@kavach/sentry`, whose `package.json` declares `"types": "dist/index.d.ts"` but ships **no `dist/`** at all.

Impact: `make test` and `make check` are red on a clean `bun install`. The "zero errors" policy in this repo's own documentation is unenforceable at head. Anyone who has ever run `make test` has seen a failure and either ignored it or is running an older lockfile.

Root cause (dependency hygiene): a `link:` / `file:` local package resolved to a stale published tarball. `.github/workflows/coverage.yml:6-8` already documents that JS coverage is *deferred* "because … local `link:` Kavach packages … aren't resolvable in CI" — the maintainers know, but nothing was done.

Fix: pin `@kavach/sentry` to a working version or vendor the fixed `src`; add a JS gate job to CI that runs `bun run check` + `bun run test` so this can't silently regress again.

---

### H2 — Desktop auth shipped the exact design DECISIONS rejected (email + password, client-only)

> **RESOLVED 2026-07-31 — decision AMENDED, not code reverted.** The owner amended DECISIONS §10.2
> (+ §9 F2): **email+password is now a blessed, viable secondary login** (set/reset password + password
> sign-in), with **magic link primary + the registration shape**, OAuth optional. So the shipped
> password path is no longer "the rejected design" — it's a supported option. **Residual work (not the
> original H2):** Seiki already matches the amended model; **Torii desktop is still password-ONLY** and
> must ADD magic-link (primary) + a reset-password path (Torii WS-5). The finding below is kept for
> history; its "drop password-only sign-in" recommendation is superseded by the amendment.

`docs/DECISIONS.md:187-189` ratifies **magic-link as primary, GitHub OAuth via `torii://` deep link** and explicitly rejects client-only email+password as a "P1a shortcut".

Shipped code is the rejected shortcut:

- `packages/core/src/auth/session.svelte.ts:59-62` — `signInWithPassword()` is the **only** sign-in method; `#sk.client.auth.signInWithPassword` is the sole Supabase auth call.
- `apps/desktop/src/routes/signin/+page.svelte:35` wires it as the only form.
- Grep confirms **zero** occurrences of `signInWithOtp`, `signInWithOAuth`, any `torii://`/`strategos://` deep-link handler, or `tauri-plugin-deep-link` in `Cargo.toml`.

Why it matters, beyond spec: this reintroduces the password-handling surface (credential storage, reset flows, breach liability) that the no-password design was chosen specifically to avoid, and it locks the desktop app to a keyboard-password UX — wrong for a client app and wrong for the ratified product.

---

### H3 — Desktop auth guard omits two shipped routes: `/compare` and `/models` are unreachable

`apps/desktop/src/routes/+layout.svelte:15-24` — `rules` list `/signin, /, /ask, /library, /playground, /workflows, /activity, /settings`. The app **ships `/routes/(app)/compare` and `/routes/(app)/models`**, so an authenticated user who navigates to either bounces straight to `/signin`.

Impact: two built and styled screens are dead on arrival — a shipped-UI bug, not just a maintenance smell.

Process failure: the guard list is hand-maintained and not derived from the route tree. Adding a route (compare, models) silently broke navigation; no e2e test covers it because the e2e suite's seeded-session bypass (see M2) never exercises the real guard.

Fix: derive allowed routes from the `(app)` route group instead of a hand-written `rules` array, and add a guard e2e that asserts an authenticated session can load every shipped route.

---

## Medium

### M1 — Desktop "cloud" plane is effectively defaulted off (demo routing leaks into prod shape)

- `apps/desktop/src/lib/cloud.ts:38` — cloud chain **defaults to `'local'`**, with a comment admitting the split: "demo routes C1 → Ollama at $0; production uses 'chat'".
- `apps/desktop/src/lib/env.ts:9-10` — `GATEWAY_URL` defaults to `http://127.0.0.1:8787` ($env/static/public, build-time baked).

Combined, the default build routes the cloud plane to a **local Ollama at $0** and never contacts the central gateway. The C1 central-gateway path the whole backend exists to serve is unexercised in the default desktop build. A "plane" indicator that always resolves to local makes `plane: 'cloud'` labels (and their `eu-west-2` badges, see M3) misleading. If 'local' is the demo default, it should be injected by the demo/e2e harness, not baked into `lib/`.

### M2 — E2E auth backdoor and infer stub live in production code paths

`apps/desktop/src/routes/+layout.svelte` (seeded-session branch) and `apps/desktop/src/lib/gateway.ts:22-30` (`VITE_E2E === 'true'` returns a canned infer result) bypass real auth and real inference behind an env var. Also in `lib/api.ts` and `lib/cloud.ts`.

It's env-gated, so not a live vuln — but it's a test backdoor shipped inside the prod bundle path, exactly the kind of branch that a future `VITE_E2E` value or a merged `.env` can accidentally flip on. Prefer the Playwright `webServer`/route-intercept pattern over product-code branches.

### M3 — Hardcoded AWS region `eu-west-2` masquerading as execution provenance

`apps/desktop/src/routes/(app)/ask/+page.svelte:113`, `playground/+page.svelte:139`, `compare/+page.svelte:292` — every `plane === 'cloud'` render hardcodes `region="eu-west-2"` and the UI labels it as the gateway region. That's cosmetic provenance with no backend source; the gateway's actual region (`fly.toml` → `primary_region = 'iad'`) is **us-east-1**. If a badge is worth rendering, it should come from the gateway response, not a hardcode that contradicts the deployed region.

### M4 — Admin dashboard blanks entirely on any single read failure

`apps/admin/src/routes/(app)/+page.svelte:40-59` — 7 backend reads in one `Promise.all`; any failure throws the whole load, the `catch` collapses all of it into one error string, and every card renders empty. For a dashboard whose purpose is showing where things broke, one failing endpoint should not take down the whole screen. `api.requests(200)` also hardcodes a 200-row window with no pagination path — fine for v1 admin, but the dashboard should surface partial data per card on failure.

---

## Low

### L1 — Stale product name: `strategos://`

`apps/desktop/src-tauri/src/gateway.rs:93` references the `strategos://` deep-link scheme and `~/.strategos/models` — the old product name, dead in a codebase that has been renamed to torii and where no `strategos://` handler exists anywhere. `Makefile:1` header still says "Strategos monorepo build coordinator". The rename is incomplete; stale names in the one file that must be correct (deep-link identity) are the kind that bite at release.

### L2 — `Makefile` test/check targets rely on gates that are red (see H1)

`Makefile:32-39` — `test`, `check`, `lint` fan out through `bun run --filter '*'`; with H1, `make test`/`make check` fail before the Cargo half even runs.

---

## What's solid (verified, no action)

These were read line-by-line and are genuinely good:

- **RLS posture** (`database/policies/rework.sql`, `secrets.sql`, `governance.sql`): privileged tables are SELECT-only for authenticated with tenant-scoped policies, service_role owns writes; `api_keys.hashed_secret` column revoked from clients even on SELECT; `config.feature_states` anon-write hole from the original design is closed (`database/import/permissions.sql:5-9`) with a regression test.
- **Adversarial DB test harness** (`database/tests/run.sh` + `authz.sql`): asserts escalation, cross-tenant, declassify, forge, and anon-write attempts fail; harness fails loudly (no `|| true` swallowing).
- **Gateway auth** (`services/gateway/src/auth.rs`): JWT/JWKS with a `claims_version` staleness gate — a versioned claims contract, not just "is the token valid".
- **Budgets** (`budgets.rs`): fail-closed reserve→commit with `WORST_CASE_USD_PER_TOKEN`, idempotency keys, ancestor row locks in `budget_reserve.ddl`.
- **API keys** (`apikeys.rs`): argon2id PHC, reveal-once.
- **DLP** (`redact.rs`): one-way redaction (`[REDACTED:kind]`), not reversible masking.
- **Privileged writes** (`routes/rpc.rs`): freshness gate → capability `require()` → service-role write → actor-bound `audit_events`. Correct pattern for a PostgREST-thin client.
- **Chat SSE** (`routes/chat.rs`): upstream errors masked server-side.
- **Admin honesty**: `(app)/tools/+page.svelte` (tool grant matrix + "saved · enforced at tool-call time" copy) and `(app)/billing/+page.svelte` (budget tree + ledger breakdown + honest plans note) match the DECISIONS billing/tools commitments.
- **Admin env** (`apps/admin/src/lib/env.ts`): `$env/dynamic/public` (runtime) correctly used in the admin app, vs desktop's build-time `$env/static/public`.
- **Desktop local plane** (`src-tauri/src/commands/infer.rs`, `gateway.rs`): embedded in-process engine, no daemon — matches DECISIONS.
- **Monorepo hygiene**: root `lint` passes (only 2 benign warnings); admin/ui/desktop test suites and `svelte-check` pass; Cargo workspace at root.

---

## Severity-weighted recommendation order

1. H1 — fix `@kavach/sentry` (or vendor it) and wire `bun run check`/`test` into CI. The gates must be green before anything else is credible.
2. H2 — **superseded by the 2026-07-31 amendment** (email+password is now a supported secondary; password stays). Residual: **Torii desktop** must ADD magic-link (primary) + a reset-password path (Seiki already has both). GitHub OAuth via `torii://` remains optional.
3. H3 — derive the guard allowlist from the route group; add a guard e2e covering every shipped route.
4. M1/M2/M3 — push demo routing and e2e stubs out of product code; source region provenance from the gateway.
5. M4/L1 — dashboard partial-failure handling; finish the rename sweep.

## Verification log

| Claim | How verified |
| --- | --- |
| Core test fails | `bun run --filter @torii/core test` → `Cannot find module '@kavach/sentry/src/types'`, exit 1 |
| Core check fails | `bun run --filter @torii/core check` → 4× TS7016, exit 2 |
| `@kavach/sentry` packaging | read `node_modules/.bun/@kavach+sentry@1.0.0/.../package.json` + `src/index.js` + `ls src/` (no `dist/`, `types.js` not `types.ts`) |
| Only password sign-in | `grep signInWithOtp/OAuth/torii:///deep-link` across `apps/desktop/src`, `packages/core/src`, `src-tauri` → zero hits |
| Guard omits routes | read `+layout.svelte:15-24` rules; `routes/(app)/compare` + `models` exist |
| cloud.ts default | read `apps/desktop/src/lib/cloud.ts:38` |
| Region hardcode | grep `eu-west-2` in desktop/ui; `fly.toml primary_region = 'iad'` |
| CI gap | `.github/workflows/coverage.yml` runs Rust coverage only; JS deferred per its own comment |
