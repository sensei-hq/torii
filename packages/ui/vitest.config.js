import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

// @torii/ui is a component library, not a SvelteKit app, so the `$app/*` virtual
// modules its shell components import aren't available under vitest. Alias them to
// local mocks (the host app provides the real ones at runtime — apps are unaffected).
const appMock = (name) => fileURLToPath(new URL(`./src/test-mocks/app-${name}.js`, import.meta.url))

export default defineConfig({
	plugins: [svelte(), svelteTesting()],
	resolve: {
		alias: {
			'$app/state': appMock('state'),
			'$app/navigation': appMock('navigation'),
			'$app/paths': appMock('paths')
		}
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.spec.svelte.js'],
		setupFiles: ['src/test-setup.js']
	}
})
