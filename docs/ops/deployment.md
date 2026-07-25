# Deployment — torii + seiki

Two very different workloads, two different hosts:

| Component | What it is | Host | Domain |
|---|---|---|---|
| **Seiki web** (`apps/admin`) | SvelteKit (adapter-cloudflare) | **Cloudflare Workers** | `seiki.sensei-hq.com` |
| **torii-gateway** (`services/gateway`) | **Rust / Axum** server + Postgres pool + tokio tasks | **Fly.io** (container) | `api.torii.sensei-hq.com` |
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
- **`api.torii.sensei-hq.com`** → the gateway API. Recommended over bare
  `torii.sensei-hq.com`: the `api.` prefix is conventional and leaves `torii.sensei-hq.com`
  free for a future Torii product/download page. The gateway is the *torii* engine, so the
  `torii` label is on-brand.
  - **SSL nuance:** `api.torii.sensei-hq.com` is a **second-level** subdomain. Cloudflare's
    free Universal SSL only covers `*.sensei-hq.com` (first level). Two clean options:
    1. **Fly.io issues the cert** (Let's Encrypt) for any depth → point DNS at Fly
       **DNS-only** (grey cloud). Simplest; also best for the streaming endpoint
       (`/v1/chat/stream` SSE) since it skips Cloudflare's proxy buffering. ← recommended.
    2. Proxy through Cloudflare (orange cloud) for WAF/DDoS → enable **Advanced Certificate
       Manager**, or use a first-level name (`api-torii.sensei-hq.com` / `torii.sensei-hq.com`).

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
  `PUBLIC_GATEWAY_URL=https://api.torii.sensei-hq.com`. `wrangler deploy` never deletes
  secrets; `keep_vars:true` also preserves dashboard plaintext vars.
- **Custom domain:** Workers → seiki → Domains & Routes → add `seiki.sensei-hq.com`.
- **First deploy / CI:** Cloudflare Workers Builds sets `WORKERS_CI`; `svelte.config.js`
  already switches to `adapter-cloudflare` on Cloudflare and `adapter-auto` locally.
  > NOTE: `apps/admin` is a client-only SPA (no SSR auth), so it does **not** need
  > `nodejs_compat` the way dojo does. It's kept minimal in `wrangler.jsonc`.

---

## 3. torii-gateway → Fly.io

`services/gateway/Dockerfile` (multi-stage Rust) + `services/gateway/fly.toml` are committed.

Run from the **repo root** (the Docker build context is the whole workspace; `fly.toml`
points at `services/gateway/Dockerfile`):

```bash
cd <repo-root>
fly apps create torii-gateway                    # once
# secrets (never in git):
fly secrets set --config services/gateway/fly.toml \
  DATABASE_URL='postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
  PUBLIC_SUPABASE_URL='https://<ref>.supabase.co' \
  TORII_KEK='<base64-32-bytes>' \
  ANTHROPIC_API_KEY='...' OPENAI_API_KEY='...'   # BYOK bootstrap; F3 vault supersedes later
fly deploy --config services/gateway/fly.toml
fly certs add api.torii.sensei-hq.com --config services/gateway/fly.toml   # Fly issues TLS
# then CNAME api.torii.sensei-hq.com → torii-gateway.fly.dev (DNS-only in Cloudflare)
```

**Env the gateway reads** (`services/gateway/src/*.rs`): `DATABASE_URL`,
`PUBLIC_SUPABASE_URL`, `PORT` (Fly sets `8080` → see `fly.toml`), `TORII_KEK` (KEK; legacy
`STRATEGOS_KEK` still accepted), `TORII_ENV` (`prod`), and each provider's BYOK key by the
env-var name in `config.routers.api_key_env_var`.

### The one build subtlety — the `[patch]`

The workspace `Cargo.toml` `[patch."https://github.com/sensei-hq/gateway"]` points the
`sensei-*` crates at the **local sibling repo** (`../gateway`) for dev-in-place. That path
does not exist in the Docker context, so the Dockerfile **strips the `[patch]` block** and
builds against the git dependency (the pinned tag). **Pin it:** set
`tag = "v0.4.6"` on the `sensei-gateway` git dep in `services/gateway/Cargo.toml` for
reproducible prod builds (today it is an unpinned git dep). The central gateway is
**cloud/HTTP-only** (no `local-engine`/llama.cpp), so the image is a plain Rust build.

---

## 4. Torii desktop

`apps/desktop` (Tauri) builds a per-OS installer. Inject the **production** env at build
(`PUBLIC_SUPABASE_URL=https://<ref>.supabase.co`, `PUBLIC_GATEWAY_URL=https://api.torii.
sensei-hq.com`, anon key) — the desktop connects to the *same hosted Supabase + gateway* as
the web app. Register the `torii://` deep-link scheme in `tauri.conf.json` for OAuth/magic-
link redirects. `cargo tauri build` (needs `MACOSX_DEPLOYMENT_TARGET=11.0`, see
`.cargo/config.toml`).

---

## 5. Request flow (prod)

```
Torii desktop ─┐                         ┌─ Anthropic / OpenAI / … (BYOK, keys server-side)
Seiki web ─────┼─ JWT ─▶ api.torii...  ──┤─ Ollama (local plane: on-device)
               │        (torii-gateway)  └─ Supabase Postgres (RLS + budgets + audit)
               └─ auth ─▶ <ref>.supabase.co  (one project; JWKS verified by the gateway)
```

Both clients authenticate against the one Supabase, forward the JWT to the gateway, and the
gateway enforces capabilities + budgets + governance server-side.
