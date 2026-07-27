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

## Deferred / follow-ups

- **F3 key vault** — provider keys are read from **env** (`router.api_key_env_var`), not the encrypted
  `router_credentials` AES-GCM vault. Replace the env resolver with vault decryption (`// TODO(F3)` in `keys.rs`).
- **Cloud provider seed audit** — several seeded `api_model_id`s were placeholders and some `api_base_url`s
  wrong (e.g. the ollama base doubled `/v1`). The local (ollama→gemma) path is corrected + verified; the
  cloud routers still need a full audit of real provider model ids / base URLs.
- **Provider billing** — the available **Anthropic** key has no credit balance (confirmed by a direct API
  call), so cloud answers need a funded account or key. The local Ollama path is $0.
- **SSE** — chunk+done, not token-streaming (engine limitation).
- **Deploy** — local `cargo run` only; container / Cloudflare `api.` is later.
