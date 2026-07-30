import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	webServer: [
		{
			command: 'bun run dev -- --port 4273',
			url: 'http://localhost:4273',
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		{
			// The React mockups, served statically — the source of truth the fidelity spec
			// diffs the app against (docs/mockups/Seiki.html at :8890, per the runbook).
			command: 'python3 -m http.server 8890 --directory ../../docs/mockups',
			url: 'http://localhost:8890/Seiki.html',
			reuseExistingServer: true,
			timeout: 30_000
		}
	],
	use: { baseURL: 'http://localhost:4273' }
})
