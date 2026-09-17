import { defineConfig } from '@playwright/test'
import { mockups } from './e2e/mockups'

// The mock-vs-app fidelity diff needs an export of the (untracked) design mockups, so it is
// a local development tool rather than part of the e2e suite. `e2e/mockups.ts` decides
// whether it runs; `e2e/run.ts` forwards the mode here via MOCKUP_FIDELITY.
//
//   bun run e2e                         → fidelity excluded
//   bun run e2e --with-mockup-fidelity  → included if an export exists; if not, e2e still runs
//   bun run mockup-fidelity             → fidelity alone; missing export is a hard error
//
// Surface a requested-but-skipped run, so "opted in and got nothing" is never silent.
if (!mockups.enabled && mockups.mode === 'with') console.warn(`⚠ ${mockups.reason}`)

export default defineConfig({
	testDir: './e2e',
	// `*.spec.ts` only — `e2e/*.test.ts` are vitest unit tests for the harness's own helpers.
	// In `only` mode the run is narrowed to the fidelity spec and nothing else.
	testMatch: mockups.enabled && mockups.onlyFidelity ? '**/fidelity.spec.ts' : '**/*.spec.ts',
	// Excluded whenever fidelity is not running, so the rest of the suite is unaffected.
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
