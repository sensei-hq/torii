import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// @kavach/* are published source-only ESM with EXTENSIONLESS relative imports (e.g.
// `export * from './types'`). Vitest's default native-ESM externalization of node_modules can't
// resolve those (`Cannot find module '.../src/types'`). Inline the @kavach packages so vitest
// transforms them through vite's resolver (which adds the `.js`) — the same way the admin/desktop
// apps already consume them via vite. Upstream packaging bug (docs/code-review.md H1) tracked at
// jerrythomas/kavach#25; this keeps `bun run test` green without vendoring or a global-link dep.
// Remove once @kavach/* publish `dist/` + extension-ful imports.
//
// The svelte plugin compiles runes STATE modules (`*.svelte.ts`, e.g. auth/session): without it
// `$state`/`$derived` are unbound identifiers at module eval. Same pattern as apps/admin.
export default defineConfig({
	plugins: [svelte()],
	test: {
		server: { deps: { inline: [/@kavach\//] } },
		coverage: {
			provider: 'v8',
			// Honest coverage (`all: true`): every source file counts, so untested
			// modules show as 0% instead of vanishing from the denominator — same
			// policy as apps/admin. Excluded: spec files, ambient `.d.ts`, and the
			// supabase client seam (I/O glue exercised by integration/e2e, not unit).
			// `lcov` feeds the Qlty upload in .github/workflows/coverage.yml.
			all: true,
			include: ['src/**/*.ts', 'src/**/*.svelte.ts'],
			exclude: ['src/**/*.spec.*', 'src/**/*.d.ts', 'src/supabase/**'],
			reporter: ['text', 'lcov']
		}
	}
})
