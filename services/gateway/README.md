# services/gateway — C1 central gateway service

Rust/Axum service wrapping the `gateway` engine crate. The sole authority for cloud (BYOK) inference:
validates a Supabase JWT, assembles routing config from Postgres, injects provider keys, runs the
engine, and persists every call. (Module: [`docs/modules/C1-gateway-service.md`](../../docs/modules/C1-gateway-service.md).)

## What it does

1. **Boot** — connect a `sqlx` Postgres pool → `load_gateway_config(pool)` builds a `GatewayConfig`
   from `config.routers` / `config.models` / `config.model_endpoints` / `public.fallback_chains` →
   `Gateway::new(config, adapters, breaker)` with the cloud adapters + (if Ollama is up) the local
   `ollama` adapter → `refresh_router_keys(env)` injects provider keys.
2. **Auth** — a tower middleware validates the JWT against the Supabase **JWKS**
   (`$PUBLIC_SUPABASE_URL/auth/v1/.well-known/jwks.json`, RS256/ES256) and extracts `tenant_id` / `role`
   claims. HS256 fallback if `SUPABASE_JWT_SECRET` is set. `/v1/*` is gated; `/health` is open.
3. **Serve** — `POST /v1/chat` builds an `InferenceRequest`, runs `gateway.execute()`, and persists the
   call to `public.inference_calls` (tenant-scoped via the JWT claim). `/v1/chat/stream` is SSE (chunk +
   done — the engine exposes `execute()`, not a token stream). `GET /v1/status` / `GET /v1/whoami`.

## Run (local dev)

```bash
# env (values are git-ignored; the local Supabase DB is postgres:postgres@127.0.0.1:54322)
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export ANTHROPIC_API_KEY=... OPENAI_API_KEY=...        # BYOK; resolved per router.api_key_env_var
# optional: export SUPABASE_JWT_SECRET=...             # enables the HS256 fallback

cargo run -p torii-gateway                              # listens on 127.0.0.1:8787
curl -s localhost:8787/health                           # {"status":"ok"}
```

Config comes from the seeded DB (`dbd apply && dbd import` from `database/`). `GET /v1/status` (authed)
shows the assembled routers/models/adapters.

## Verified end-to-end

A JWT-bearing `POST /v1/chat` with `chain:"local"` routes to on-device **Ollama** and returns a real
`$0` answer, persisted to `inference_calls` with the token's `tenant_id`:

```json
{"content":"hello","model":"llama3.2","cost_usd":0.0,"input_tokens":24,"output_tokens":2}
```

(The `local` chain's `ollama/llama3.2` step carries `router_model_id=gemma4:latest`, so the actual run
is gemma4; `model` is the chain candidate's config name.)

## Analytics (O2 · P12)

Read-only, tenant-scoped dashboards over the **one** `inference_calls` ledger (+ `quality_signals`,
catalog, budget tree) — no hot-path write, no second cost table. Endpoints (all under the auth'd `/v1`):

| Endpoint | Returns |
|---|---|
| `GET /v1/analytics/overview` | stat row: spend/calls/fallbacks today, latency avg+p95, blended cost/call 14d + delta, savings 14d |
| `GET /v1/analytics/cost-trend?window=&bucket=day` | blended cost/call series + period delta |
| `GET /v1/analytics/model-mix?window=` | per-model calls / share % / cost / savings |
| `GET /v1/analytics/plane-split?window=&scope_node_id=` | **local-vs-cloud savings** (the headline claim) |
| `GET /v1/analytics/spend?group_by=org\|dept\|team\|user\|model\|provider\|capability&window=&scope_node_id=` | per-scope spend, grouped with **no recursive CTE** (GH-5 denormalized columns) |
| `GET /v1/analytics/quality?window=` | grounding / judge / guardrail-hit / redaction-hit / rating aggregates |
| `GET /v1/analytics/export?report=&format=csv\|json` | **aggregated** rollups only (raw-row/SIEM export is O1) |
| `GET /v1/analytics/metrics[?key=]` | the versioned metric descriptor (`unit`/`source` per key); unknown `key` → `422` |

- **Two read paths.** `spend` + `plane-split` read the ledger on the fly (they need the GH-5
  denormalized attribution columns + the per-call cloud-equivalent baseline); the other panels read the
  **live rollup tables** (`analytics_usage_daily` / `analytics_quality_daily`, kept current by the A2
  `AFTER INSERT` triggers on `inference_calls` + `quality_signals`).
- **Rollups are a reconstructable cache, never a source of truth.** `analytics_rollup_reconcile(tenant, day)`
  recomputes a day from the immutable ledger alone (re-pricing savings, computing p95); zeroing the
  rollups and reconciling reproduces identical figures. Drift beyond tolerance emits an
  `analytics.reconciled` audit row (O1). `analytics_refresh_mviews()` refreshes the two MVs CONCURRENTLY
  (on-demand today; `pg_cron` ~60s schedule is a deferred operational step — see below).
- **Savings baseline** (`analytics_cloud_equiv`) prices a local call at the **cheapest priced cloud step**
  in its chain (conservative floor); local-only chains and unpriced counterfactuals are surfaced, never guessed.
- **Scope authz.** Own-subtree reads need no capability; tenant-wide / cross-subtree (or a `scope_node_id`
  outside the caller's subtree) requires **`audit.read`** → else `403 capability_required`. The caller's
  scope is their personal budget leaf (no org-root fallback). MVs carry no RLS → never granted to clients.

Tests: `database/tests/analytics.sql` (rollup/savings/reconcile) + `authz.sql` §12 (tenant isolation);
`cargo test -p torii-gateway --bin torii-gateway -- --include-ignored analytics` (builders, P12 gate,
scope authz, descriptor, no-secret-surface).

## Deferred / follow-ups

- **Analytics MV schedule** — `pg_cron` is available but not enabled on the local stack, so the ~60s
  `analytics_refresh_mviews()` / periodic `analytics_rollup_reconcile()` schedule isn't running yet;
  refresh is on-demand. Enable `pg_cron` (or wire the scheduled-job runner) in the deploy env.

- **F3 key vault** — provider keys are read from **env** (`router.api_key_env_var`), not the encrypted
  `router_credentials` AES-GCM vault. Replace the env resolver with vault decryption (`// TODO(F3)` in `keys.rs`).
- **Cloud provider seed audit** — several seeded `api_model_id`s were placeholders and some `api_base_url`s
  wrong (e.g. the ollama base doubled `/v1`). The local (ollama→gemma) path is corrected + verified; the
  cloud routers still need a full audit of real provider model ids / base URLs.
- **Provider billing** — the available **Anthropic** key has no credit balance (confirmed by a direct API
  call), so cloud answers need a funded account or key. The local Ollama path is $0.
- **SSE** — chunk+done, not token-streaming (engine limitation).
- **Deploy** — local `cargo run` only; container / Cloudflare `api.` is later.
