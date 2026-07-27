# Provider credentials — env → vault cutover (BYOK)

How the gateway sources the API key it presents to an upstream provider, and how that
source moved from **process env vars** to the **per-tenant vault**. This closes blueprint
gap **G2** (`docs/blueprints/f3-byok-credential-vault.md`): the vault is authoritative and
the env path is a logged, retiring fallback.

## Principle — tenants are isolated on their own keys

A tenant authenticates to remote providers with **its own** sealed key. There is **no
cross-tenant platform fallback**: one tenant never spends on, or is billed against, another
tenant's (or the platform's) credential. A shared platform key that any tenant could fall
onto would break budget attribution and tenant isolation — the core security premise. The
only thing the platform provides directly is **keyless local routers** (e.g. `ollama`),
which need no credential at all.

## The two credential sources

| Source | Where | Scope | Role |
|---|---|---|---|
| **Vault** (`public.router_credentials`) | Postgres, sealed by tenant DEK → KEK | **per tenant** | **Authoritative.** The tenant's BYOK key, set via the admin Connections screen. |
| **Env var** (`OPENAI_API_KEY`, …) | gateway process env | process-wide | **Transitional fallback** for a router a tenant hasn't connected. Being retired (see exit criterion). |

## How resolution works today (F3-4)

Per request, `inject_tenant_credentials` (`services/gateway/src/routes/chat.rs`) overlays
the caller-tenant's decrypted vault keys onto `InferenceRequest.credentials`. The engine
prefers a per-call credential over the router's platform/env key. It is **fail-safe** — no
tenant, an empty map, or a vault error leaves the request on platform keys; a bad BYOK
setup never denies inference.

- **Connected router** → the tenant's vault key is used (env var can be unset).
- **Not-connected remote router** → falls through to the platform/env key (transitional).
- **Local router** (no `api_key_env_var`) → no key needed.

The tenant's key set is memoized in `TenantKeyCache` — now the shared `sensei-vault` crate's
(gateway#38 V5); the gateway pins it to `EnvKekProvider` + `PostgresVaultStore` in `state.rs`.
Decrypt-on-miss, invalidated on every connect / rotate / revoke, so a rotation takes effect on
the next call without a restart.

## Admin surface (F3-5)

The Connections screen (`apps/admin/.../connections/+page.svelte`) drives the vault via the
capability-gated (`connection.manage`) RPCs `/rpc/connections/{connect,rotate,revoke}`. The
grid reflects per-tenant state from `GET /v1/connections` (`requires_key` / `connected` /
`connected_at`). The secret is write-only — entered in a password field, sealed server-side,
and **never** returned or rendered.

## Cutover status & exit criterion

- **Done:** vault is the authoritative per-request source; admin can connect/rotate/revoke;
  keys are sealed at rest and absent from logs and the read model.
- **Remaining (env retirement):** the env fallback for **remote** routers is still active as
  a migration bridge.

**Exit criterion — retire the env path for tenant traffic when:** every active tenant has
connected its own key for each remote router it uses. At that point, remove the env-var
fallback from tenant request resolution so a not-connected remote router **fails closed**
(unavailable) rather than borrowing a shared key — matching what the UI already shows
("not set"). Env keys, if kept, then serve only local dev / the platform tenant's own usage.

> **Observability gap:** today the fallback is only logged on a vault *error*, not when a
> request quietly uses the env key for a not-connected router. Before flipping the exit
> criterion, add a per-router "using env fallback for `<router>`" WARN so env usage is
> visibly drained to zero. Tracked with the follow-ups below.

## How the cutover is proven

- **Per-tenant isolation** (query layer): `cargo test -p torii-gateway -- --ignored
  connected_is_per_tenant_isolated` — tenant B never receives tenant A's key.
- **Live round-trip:** `services/gateway/scripts/byok-isolation-e2e.sh` — connect → used /
  rotate advances / revoke clears, against the running gateway (no secret in the read model).
- **Admin UI:** `apps/admin/e2e/connections.spec.ts` — connect → connected → re-fetch
  persists → revoke.
- **Provider reach (env unset):** verified live in F3-4 (the BYOK key reaches the provider
  with the env var unset).

## Follow-ups

- **[#16](https://github.com/sensei-hq/torii/issues/16)** — OAuth credential vault (GH-2).
- **[#17](https://github.com/sensei-hq/torii/issues/17)** — production KMS-backed KEK
  (**done**). Prod reads the KEK from **Supabase Vault** (`SupabaseVaultKekProvider`) under
  `TORII_KEK_VAULT_SECRET` (default `torii_kek`); a raw env KEK is refused under `TORII_ENV=prod`.
  Rotation via `Vault::rotate_kek`. See `deployment.md` → *Vault-crate cutover*.
- **[#18](https://github.com/sensei-hq/torii/issues/18)** — rename `router_keys` →
  `router_credentials` (**done**).
