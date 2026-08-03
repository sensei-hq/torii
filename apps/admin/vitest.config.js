import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Unit tests for PURE logic (filters, identity, derivations) — node env — PLUS runes STATE
// modules (`*.svelte.ts`, e.g. alerts-state): the svelte plugin compiles their $state/$derived
// so the state layer of the ui-state-pattern is testable. Component/e2e stays in Playwright.
export default defineConfig({
	plugins: [svelte()],
	test: {
		environment: 'node',
		include: ['src/**/*.spec.ts', 'src/**/*.spec.svelte.ts'],
		coverage: {
			provider: 'v8',
			// Cover the testable logic: pure derivations + runes state modules. The api.ts
			// fetch seam and env/auth glue are I/O — integration-tested via Playwright e2e,
			// not unit coverage — so they're excluded to keep the number meaningful.
			// `all: true` counts every matching file (even untested ones show as 0%), so the
			// number is honest, not just "coverage of the files a test happened to import".
			all: true,
			include: ['src/lib/**/*.ts', 'src/lib/**/*.svelte.ts'],
			exclude: ['src/lib/api.ts', 'src/lib/env.ts', 'src/lib/auth-flow.ts', '**/*.spec.*'],
			thresholds: { lines: 80, functions: 80, statements: 80 }
		}
	}
})
