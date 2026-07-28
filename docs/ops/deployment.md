# Deployment — torii + seiki

Two very different workloads, two different hosts:

| Component | What it is | Host | Domain |
|---|---|---|---|
| **Seiki web** (`apps/admin`) | SvelteKit (adapter-cloudflare) | **Cloudflare Workers** | `seiki.sensei-hq.com` |
| **torii-gateway** (`services/gateway`) | **Rust / Axum** server + Postgres pool + tokio tasks | **Fly.io** (container) | `api-torii.sensei-hq.com` |
| **Torii desktop** (`apps/desktop`) | Tauri app | distributed installer | (runs on user machines) |

> **The API cannot go on Cloudflare Pages/Workers.** Those run static assets + V8 isolates
> (JS/WASM). The gateway is a long-running native binary that holds a Postgres connection
> pool, runs background tokio tasks (SIEM streamer, circuit breakers), and links the
> `sensei-*` crates — none of which fit the Workers model. It needs a **container/VM**
> host. Recommended: **Fly.io** (first-class Rust + Postgres, global, free TLS on any
> subdomain). Alternatives: Railway, Render, a Docker VPS, or Cloudflare **Containers**
> (newer, if you want to stay all-Cloudflare).

---

## 1. Domains

- **`seiki.sensei-hq.com`** → the Seiki web SaaS.
- **`api-torii.sensei-hq.com`** → the gateway API. Chosen over `api.torii.sensei-hq.com`
  because a hyphenated **first-level** subdomain is covered by Cloudflare's free Universal
  SSL (`*.sensei-hq.com`) — a `.`-nested `api.torii.…` is second-level and would need
  Advanced Certificate Manager. It still keeps bare `torii.sensei-hq.com` free for a future
  Torii product/download page, and the `torii` label is on-brand (the gateway is the engine).
  - **TLS:** either **DNS-only** (grey cloud) → Fly.io issues the Let's Encrypt cert
    (simplest, and best for the `/v1/chat/stream` SSE endpoint since it skips Cloudflare
    proxy buffering — recommended); or **proxied** (orange cloud) for WAF/DDoS, which works
    out of the box on Universal SSL.

---

## 2. Seiki web → Cloudflare Workers

Mirrors `~/Developer/sensei-hq/sensei/dojo` (Workers Static Assets, not a Pages project).
`apps/admin` already uses `@sveltejs/adapter-cloudflare`; `apps/admin/wrangler.jsonc` is
committed.

```bash
cd apps/admin
bun install
bun run build            # emits .svelte-kit/cloudflare/
bunx wrangler deploy     # deploys the Worker named "seiki"
```

- **Secrets** (dashboard → Workers → seiki → Settings → Variables, as *encrypted secrets*,
  never in git — this repo is public): `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
  `PUBLIC_GATEWAY_URL=https://api-torii.sensei-hq.com`. `wrangler deploy` never deletes
  secrets; `keep_vars:true` also preserves dashboard plaintext vars.
- **Custom domain:** Workers → seiki → Domains & Routes → add `seiki.sensei-hq.com`.
- **First deploy / CI:** Cloudflare Workers Builds sets `WORKERS_CI`; `svelte.config.js`
  already switches to `adapter-cloudflare` on Cloudflare and `adapter-auto` locally.
  > NOTE: `apps/admin` is a client-only SPA (no SSR auth), so it does **not** need
  > `nodejs_compat` the way dojo does. It's kept minimal in `wrangler.jsonc`.

---

## 3. torii-gateway → Fly.io

`services/gateway/Dockerfile` (multi-stage Rust) + **`fly.toml` at the repo root** are committed.

**`fly.toml` lives at the repo root on purpose:** Fly uses the directory holding `fly.toml` as
the Docker build **context**, and this build needs the whole workspace (the Dockerfile COPYs
`Cargo.toml`/`Cargo.lock`/`services/`/`apps/…`). So **always run `fly` from the repo root** —
`fly.toml`'s `dockerfile = "services/gateway/Dockerfile"` is relative to that root context. Do
**not** put `fly.toml` under `services/gateway` or run from there: Fly then resolves the
dockerfile path against `services/gateway/` → `services/gateway/services/gateway/Dockerfile` →
"Dockerfile not found". (Same for the GitHub-integration "working directory" — set it to root.)

```bash
cd <repo-root>                                   # fly.toml is HERE
fly apps create torii-gateway                    # once
# secrets (never in git) — BYOK-only, so NO provider api-key env vars:
fly secrets set \
  DATABASE_URL='postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
  PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
# The vault KEK is NOT an env secret — in prod (TORII_ENV=prod) a raw TORII_KEK is refused
# (gap #1). Seed it into Supabase Vault once (base64 of 32 bytes, default name `torii_kek`):
#   psql "$DATABASE_URL" -c "select vault.create_secret('<base64-32-bytes>', 'torii_kek')"
fly deploy                                       # picks up ./fly.toml, context = repo root
fly certs add api-torii.sensei-hq.com            # Fly issues TLS
# then CNAME api-torii.sensei-hq.com → torii-gateway.fly.dev (DNS-only in Cloudflare)
```

**Env the gateway reads** (`services/gateway/src/*.rs`): `DATABASE_URL`,
`PUBLIC_SUPABASE_URL`, `PORT` (Fly sets `8080` → see `fly.toml`), `TORII_ENV` (`prod`), and
each provider's BYOK key by the env-var name in `config.routers.api_key_env_var`. Vault KEK:
in **dev** a base64 `TORII_KEK` (legacy `STRATEGOS_KEK` accepted); in **prod** the KEK is read
from **Supabase Vault** (raw env KEK refused) under the secret named by `TORII_KEK_VAULT_SECRET`
(default `torii_kek`).

### The one build subtlety — the `[patch]`

The workspace `Cargo.toml` `[patch."https://github.com/sensei-hq/gateway"]` points the
`sensei-*` crates at the **local sibling repo** (`../gateway`) for dev-in-place. That path
does not exist in the Docker context, so the Dockerfile **strips the `[patch]` block** and
builds against the git dependency (the pinned tag). The `sensei-gateway` **and
`sensei-vault`** git deps are pinned to `tag = "v0.4.7"` in `services/gateway/Cargo.toml`
for reproducible prod builds. The central gateway is
**cloud/HTTP-only** (no `local-engine`/llama.cpp), so the image is a plain Rust build.

### Vault-crate cutover (v0.4.7) — do this IN ORDER before first deploy of the crate build

The F3 vault moved from inline code to the shared `sensei-vault` crate (gateway#38 V5). The
crate seals credentials **AAD-bound** (`tenant‖router`) and needs a schema the earlier inline
vault didn't. Deploying the crate build to a prod DB **without** these steps breaks writes
(the `ON CONFLICT … WHERE is_active` upsert needs the partial index) and reads (old empty-AAD
rows fail to unseal). Sequence:

1. **Apply the V4 schema to the prod Supabase** — `core.tenant_key_archive`, the partial
   `router_credentials_active_ukey` (replacing the full unique), and their RLS. Apply the
   DDL/policies as SQL (do **not** `dbd reset` a DB with real data — see
   `supabase-configuration.md`).
2. **Seed the prod KEK into Supabase Vault** — `select vault.create_secret('<base64-32-bytes>',
   'torii_kek')` (or the name in `TORII_KEK_VAULT_SECRET`). Without it, prod comes up with BYOK
   disabled (platform/env keys still serve).
3. **Re-seal any pre-AAD rows** — for a DB that already held BYOK keys under the *inline*
   (empty-AAD) vault, run the one-shot with the **prod** KEK:
   `TORII_KEK=<prod> DATABASE_URL=<prod> cargo test -p sensei-vault --features sqlx -- --ignored reseal_all_pre_aad_credentials --nocapture`
   (idempotent; a fresh prod DB with no BYOK rows is a no-op).
4. **Then** `fly deploy` the crate build.

> **KEK custody in prod (gap #1, torii#17 — wired).** Under `TORII_ENV=prod` a raw `TORII_KEK`
> env var is **refused** (`EnvKekProvider` fails closed); the KEK is read from **Supabase Vault**
> (`SupabaseVaultKekProvider`) under `TORII_KEK_VAULT_SECRET` (default `torii_kek`) — never raw
> on the host, and absent from a plain DB dump. A missing/unreadable secret disables BYOK
> (fail-safe) rather than denying inference. KEK rotation: `Vault::rotate_kek` re-wraps every
> DEK; rotate the underlying Supabase-Vault secret in the same window.

---

## 4. Torii desktop

`apps/desktop` (Tauri) builds a per-OS installer. Inject the **production** env at build
(`PUBLIC_SUPABASE_URL=https://<ref>.supabase.co`,
`PUBLIC_GATEWAY_URL=https://api-torii.sensei-hq.com`, anon key) — the desktop connects to
the *same hosted Supabase + gateway* as
the web app. Register the `torii://` deep-link scheme in `tauri.conf.json` for OAuth/magic-
link redirects. `cargo tauri build` (needs `MACOSX_DEPLOYMENT_TARGET=11.0`, see
`.cargo/config.toml`).

---

## 5. Request flow (prod)

```
Torii desktop ─┐                         ┌─ Anthropic / OpenAI / … (BYOK, keys server-side)
Seiki web ─────┼─ JWT ─▶ api-torii...  ──┤─ Ollama (local plane: on-device)
               │        (torii-gateway)  └─ Supabase Postgres (RLS + budgets + audit)
               └─ auth ─▶ <ref>.supabase.co  (one project; JWKS verified by the gateway)
```

Both clients authenticate against the one Supabase, forward the JWT to the gateway, and the
gateway enforces capabilities + budgets + governance server-side.
