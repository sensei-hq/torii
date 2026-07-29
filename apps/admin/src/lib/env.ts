// Read public config at RUNTIME via $env/dynamic/public (not $env/static/public):
// on Cloudflare Workers these arrive as runtime env/secrets, so a static (build-time)
// import fails the CI build with MISSING_EXPORT when no build-time .env is present.
// Mirrors dojo. Local dev still works — Vite feeds the gitignored .env into this at runtime.
import { env } from '$env/dynamic/public'

export const SUPABASE_URL = env.PUBLIC_SUPABASE_URL
export const SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY
// The C1 central gateway — the admin's single privileged read/write target.
export const GATEWAY_URL = env.PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:8787'
