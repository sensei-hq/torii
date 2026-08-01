import { defineConfig } from 'vitest/config'

// @kavach/* are published source-only ESM with EXTENSIONLESS relative imports (e.g.
// `export * from './types'`). Vitest's default native-ESM externalization of node_modules can't
// resolve those (`Cannot find module '.../src/types'`). Inline the @kavach packages so vitest
// transforms them through vite's resolver (which adds the `.js`) — the same way the admin/desktop
// apps already consume them via vite. Upstream packaging bug (docs/code-review.md H1) tracked at
// jerrythomas/kavach#25; this keeps `bun run test` green without vendoring or a global-link dep.
// Remove once @kavach/* publish `dist/` + extension-ful imports.
export default defineConfig({
	test: {
		server: { deps: { inline: [/@kavach\//] } }
	}
})
