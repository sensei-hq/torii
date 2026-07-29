import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// Deploy-config contract for the seiki Cloudflare Worker. Two regressions are locked here,
// both of which broke the CF Workers Build / runtime while passing a local build:
//
// 1. nodejs_compat — apps/admin ships SvelteKit server code (a Kavach `handle` hook +
//    a server layout load), and SvelteKit's server runtime imports `node:async_hooks`.
//    Without the flag `wrangler deploy` uploads fine but the Worker throws at runtime.
//
// 2. runtime (not build-time) public env — public config must be read via
//    `$env/dynamic/public` (runtime), never `$env/static/public` (inlined at build).
//    CF Workers Build has no build-time .env — the values are runtime Secrets — so a
//    static import fails the build with MISSING_EXPORT. Locally it passes only because a
//    gitignored .env feeds the build.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const parseJsonc = (raw: string): Record<string, unknown> =>
	JSON.parse(
		raw
			.replace(/\/\*[\s\S]*?\*\//g, '') // block comments
			.replace(/(^|[^:])\/\/.*$/gm, '$1') // line comments (leaves `https://` intact)
	)

const wrangler = parseJsonc(read('../../wrangler.jsonc'))
const envSource = read('./env.ts')

test('wrangler.jsonc enables nodejs_compat (SvelteKit server runtime needs node:async_hooks)', () => {
	expect(wrangler.compatibility_flags).toContain('nodejs_compat')
})

test('lib/env.ts reads public config at runtime via $env/dynamic/public, not $env/static/public', () => {
	// Match the import statement itself, so the explanatory comment (which names the
	// static path to say we avoid it) does not trip the assertion.
	expect(envSource).toMatch(/from ['"]\$env\/dynamic\/public['"]/)
	expect(envSource).not.toMatch(/from ['"]\$env\/static\/public['"]/)
})
