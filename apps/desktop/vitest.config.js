import { defineConfig } from 'vitest/config'

// Unit tests for PURE logic only (screen derivations like src/lib/home.ts) — node env, no
// Svelte plugin, no $env/$lib/Tauri. Component/e2e testing is separate (Playwright, e2e/).
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.spec.ts']
	}
})
