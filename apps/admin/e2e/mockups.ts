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
//   bun run e2e                         → 'off'  · fidelity excluded
//   bun run e2e --with-mockup-fidelity  → 'with' · included when an export exists;
//                                          when it does not, e2e STILL RUNS without it
//   bun run mockup-fidelity             → 'only' · fidelity alone; a missing export
//                                          is a hard error
//
// The asymmetry is deliberate. "e2e plus a bonus" must not be broken by a missing
// bonus; "run exactly this" must not quietly run nothing and exit 0, which reads as
// a pass.
//
// Overrides (both modes): MOCKUPS_DIR=<path> (relative resolves against apps/admin,
// preserving the historical ../../docs/mockups) and MOCKUPS_PORT=<n> (default 8890).
// ─────────────────────────────────────────────────────────────────────────────

/** The export directory, relative to apps/admin — the historical harness path. */
const DEFAULT_DIR = '../../docs/mockups'
const DEFAULT_PORT = 8890

const WITH_FLAG = '--with-mockup-fidelity'
const ONLY_FLAG = '--only-mockup-fidelity'

/** apps/admin — the directory playwright.config.ts lives in. */
export const CONFIG_DIR = resolve(fileURLToPath(import.meta.url), '..', '..')

export type Mode = 'off' | 'with' | 'only'

export type Mockups =
	| { enabled: false; mode: Mode; reason: string }
	| {
			enabled: true
			mode: 'with' | 'only'
			onlyFidelity: boolean
			dir: string
			port: number
			url: string
	  }

/**
 * Split our own flags out of the argv the user meant for playwright.
 * Playwright's CLI rejects unknown options, so the runner must strip these before exec.
 */
export function parseMockupFidelityArgs(argv: string[]): { mode: Mode; rest: string[] } {
	const rest = argv.filter((a) => a !== WITH_FLAG && a !== ONLY_FLAG)
	// --only is the more specific request, so it wins if both are given.
	const mode: Mode = argv.includes(ONLY_FLAG) ? 'only' : argv.includes(WITH_FLAG) ? 'with' : 'off'
	return { mode, rest }
}

/**
 * Decide whether the fidelity harness runs, and where it reads the mockups from.
 *
 * @param mode    'off' | 'with' | 'only' — see the module comment
 * @param env     process env (injected so the decision is testable)
 * @param exists  directory predicate (injected for the same reason)
 * @param baseDir directory that relative `MOCKUPS_DIR` values resolve against
 * @throws in 'only' mode when the export is missing, or when MOCKUPS_PORT is not a number
 */
export function resolveMockups(
	mode: Mode,
	env: Record<string, string | undefined>,
	exists: (path: string) => boolean,
	baseDir: string
): Mockups {
	if (mode === 'off')
		return {
			enabled: false,
			mode,
			reason: `mockup fidelity excluded — pass ${WITH_FLAG} to include it, or run \`bun run mockup-fidelity\``
		}

	const configured = env.MOCKUPS_DIR?.trim()
	const requested = configured && configured.length > 0 ? configured : DEFAULT_DIR
	const dir = isAbsolute(requested) ? requested : resolve(baseDir, requested)

	if (!exists(dir)) {
		const detail =
			`no design mockups at ${dir}\n` +
			`The mockups are untracked — export the claude.ai design project into docs/mockups/, ` +
			`or set MOCKUPS_DIR to an existing export.`
		// 'only' was an explicit request for these tests and nothing else: refuse.
		if (mode === 'only') throw new Error(detail)
		// 'with' was "e2e, plus fidelity if you can": run the rest.
		return { enabled: false, mode, reason: `mockup fidelity skipped — ${detail}` }
	}

	const port = env.MOCKUPS_PORT ? Number(env.MOCKUPS_PORT) : DEFAULT_PORT
	if (!Number.isInteger(port) || port <= 0)
		throw new Error(
			`MOCKUPS_PORT must be a positive integer, got ${JSON.stringify(env.MOCKUPS_PORT)}`
		)

	return {
		enabled: true,
		mode,
		onlyFidelity: mode === 'only',
		dir,
		port,
		url: `http://localhost:${port}/Seiki.html`
	}
}

/**
 * The resolution for this process. The runner (`e2e/run.ts`) strips our flags and
 * forwards the mode in `MOCKUP_FIDELITY`, because playwright.config.ts is loaded by
 * playwright itself and never sees the original argv.
 */
export const mockups: Mockups = resolveMockups(
	(process.env.MOCKUP_FIDELITY as Mode) || 'off',
	process.env,
	existsSync,
	CONFIG_DIR
)
