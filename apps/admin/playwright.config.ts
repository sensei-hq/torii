import { defineConfig } from '@playwright/test'
import { mockups } from './e2e/mockups'

// The mock-vs-app fidelity diff is a local development tool, not part of the e2e suite —
// it needs an export of the (untracked) design mockups. `e2e/mockups.ts` decides whether
// it runs; everything else in e2e/ is unaffected either way. Opt in with:
//   FIDELITY=1 bun run test:e2e          (or: bun run test:fidelity)
//   FIDELITY=1 MOCKUPS_DIR=/path/to/export bun run test:e2e
export default defineConfig({
	testDir: './e2e',
	// `*.spec.ts` only — `e2e/*.test.ts` are vitest unit tests for the harness's own helpers.
	testMatch: '**/*.spec.ts',
	// Excluded unless fidelity is explicitly requested AND an export is present.
	testIgnore: mockups.enabled ? [] : ['**/fidelity.spec.ts'],
	timeout: 30_000,
	webServer: [
		{
			command: 'bun run dev -- --port 4273',
			url: 'http://localhost:4273',
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		// Only started when the fidelity spec will actually run.
		...(mockups.enabled
			? [
					{
						// The React mockups, served statically — the source of truth the fidelity
						// spec diffs the app against (Seiki.html, per the runbook).
						command: `python3 -m http.server ${mockups.port} --directory ${JSON.stringify(mockups.dir)}`,
						url: mockups.url,
						reuseExistingServer: true,
						timeout: 30_000
					}
				]
			: [])
	],
	use: { baseURL: 'http://localhost:4273' }
})
