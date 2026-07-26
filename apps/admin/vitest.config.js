import { defineConfig } from 'vitest/config'

// Unit tests for PURE logic only (filters, identity helpers) — node env, no Svelte
// plugin, no $env/$lib. Component/e2e testing is separate (Playwright for e2e).
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.spec.ts']
	}
})
