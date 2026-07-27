import { execFileSync, spawnSync } from 'child_process'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const APP_REPO = resolve(__dirname, '..') // apps/desktop/
const MONOREPO_ROOT = resolve(__dirname, '../../..') // monorepo/
// Workspace target: cargo workspace places bundles in monorepo/target, not src-tauri/target.
// Binary inside the bundle is named after the crate package name ("app"), not productName.
const APP_BUNDLE = join(MONOREPO_ROOT, 'target/debug/bundle/macos/torii.app')
const APP_BINARY = join(APP_BUNDLE, 'Contents/MacOS/app')
const SOCKET = '/tmp/tauri-playwright.sock'
const PID_FILE = '/tmp/torii-e2e-pid'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function waitForSocket(path: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (existsSync(path)) return
		await sleep(500)
	}
	throw new Error(`Timed out waiting for ${path}`)
}

export default async function globalSetup(): Promise<void> {
	// Build the e2e bundle (frontend + Rust). First run compiles Rust — slow.
	// The VITE_E2E flag MUST reach the SvelteKit build (it bakes the seeded session +
	// stubbed inference — without it the app renders /signin and every test fails). Tauri
	// does NOT forward the parent env to its beforeBuildCommand, so we override that command
	// inline to carry the flag itself, rather than relying on env inheritance.
	execFileSync(
		'bunx',
		[
			'tauri',
			'build',
			'--debug',
			'--features',
			'e2e-testing',
			'--config',
			'{"build":{"beforeBuildCommand":"VITE_E2E=true bun run build"}}'
		],
		{ cwd: APP_REPO, stdio: 'inherit', env: { ...process.env, VITE_E2E: 'true' } }
	)
	try {
		execFileSync('/usr/bin/pkill', ['-f', 'torii.app'], { stdio: 'ignore' })
	} catch {}
	await sleep(1_000)
	try {
		unlinkSync(SOCKET)
	} catch {}

	// Launch via macOS `open` so the app gets proper app-context, LSEnvironment,
	// and WKWebView process isolation — spawning the binary directly can leave
	// WKWebView in a degraded state that blocks JavaScript evaluation.
	// `open -n -a` opens a new instance even if one is already running.
	spawnSync('/usr/bin/open', ['-n', '-a', APP_BUNDLE], { stdio: 'ignore' })

	// Wait for the socket (plugin creates it as soon as the Rust init runs).
	await waitForSocket(SOCKET, 60_000)
	// Give WKWebView time to finish loading and its JS runtime to be ready.
	// (The socket appears before WKWebView's JS is initialised.)
	await sleep(5_000)

	// Record the PID of the running process for teardown.
	const result = spawnSync('/usr/bin/pgrep', ['-n', '-f', 'torii.app'], { encoding: 'utf8' })
	const pid = result.stdout.trim()
	if (pid) writeFileSync(PID_FILE, pid)
}
