import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Unit tests for PURE logic (filters, identity, derivations) — node env — PLUS runes STATE
// modules (`*.svelte.ts`, e.g. alerts-state): the svelte plugin compiles their $state/$derived
// so the state layer of the ui-state-pattern is testable. Component/e2e stays in Playwright.
export default defineConfig({
	plugins: [svelte()],
	test: {
		environment: 'node',
		include: ['src/**/*.spec.ts', 'src/**/*.spec.svelte.ts']
	}
})
