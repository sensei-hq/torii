import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// Where the design mockups live, and whether the fidelity harness may run.
//
// The mockups are authored in the claude.ai design project and exported into
// docs/mockups/ — which is UNTRACKED (see .gitignore). So the mock-vs-app
// fidelity diff is a LOCAL DEVELOPMENT tool, not part of the e2e suite:
//
//   · default            → disabled; the rest of the e2e suite runs untouched
//   · FIDELITY=1         → enabled; requires an export to be present
//   · MOCKUPS_DIR=<path> → point at a different export (relative paths resolve
//                          against apps/admin, matching the old ../../docs/mockups)
//   · MOCKUPS_PORT=<n>   → serve on a different port (default 8890)
//
// Asking for fidelity without an export is a hard error, not a skip: a missing
// directory would otherwise surface as a connection-refused at :8890 long after
// the cause.
// ─────────────────────────────────────────────────────────────────────────────

/** The export directory, relative to apps/admin — the historical harness path. */
const DEFAULT_DIR = '../../docs/mockups'
const DEFAULT_PORT = 8890

/** apps/admin — the directory playwright.config.ts lives in. */
export const CONFIG_DIR = resolve(fileURLToPath(import.meta.url), '..', '..')

export type Mockups =
	{ enabled: false; reason: string } | { enabled: true; dir: string; port: number; url: string }

/**
 * Decide whether the fidelity harness runs, and where it reads the mockups from.
 *
 * @param env    process env (injected so the decision is testable)
 * @param exists directory predicate (injected for the same reason)
 * @param baseDir directory that relative `MOCKUPS_DIR` values resolve against
 * @throws if fidelity is requested but the export is missing, or the port is not a number
 */
export function resolveMockups(
	env: Record<string, string | undefined>,
	exists: (path: string) => boolean,
	baseDir: string
): Mockups {
	if (!env.FIDELITY)
		return {
			enabled: false,
			reason:
				'fidelity harness off — set FIDELITY=1 to diff the app against the design mockups (local development only)'
		}

	const configured = env.MOCKUPS_DIR?.trim()
	const requested = configured && configured.length > 0 ? configured : DEFAULT_DIR
	const dir = isAbsolute(requested) ? requested : resolve(baseDir, requested)

	if (!exists(dir))
		throw new Error(
			`FIDELITY=1 but no design mockups at ${dir}\n` +
				`The mockups are untracked — export the claude.ai design project into docs/mockups/, ` +
				`or set MOCKUPS_DIR to an existing export.`
		)

	const port = env.MOCKUPS_PORT ? Number(env.MOCKUPS_PORT) : DEFAULT_PORT
	if (!Number.isInteger(port) || port <= 0)
		throw new Error(
			`MOCKUPS_PORT must be a positive integer, got ${JSON.stringify(env.MOCKUPS_PORT)}`
		)

	return { enabled: true, dir, port, url: `http://localhost:${port}/Seiki.html` }
}

/** The resolution for this process — what playwright.config.ts and the spec both read. */
export const mockups: Mockups = resolveMockups(process.env, existsSync, CONFIG_DIR)
