#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { parseMockupFidelityArgs } from './mockups'

// Thin wrapper around `playwright test`.
//
// Playwright's CLI rejects unknown options, so `--with-mockup-fidelity` /
// `--only-mockup-fidelity` cannot be passed through. We strip them here and forward the
// decision to playwright.config.ts as MOCKUP_FIDELITY, which is the only channel the
// config can read (it is loaded by playwright, not by us, so it never sees this argv).
//
//   bun run e2e                              → mockup fidelity excluded
//   bun run e2e --with-mockup-fidelity       → included if an export exists, skipped if not
//   bun run mockup-fidelity                  → fidelity alone; missing export = error
//
// Every other argument is forwarded untouched (--headed, -g, --ui, a path filter, …).

const { mode, rest } = parseMockupFidelityArgs(process.argv.slice(2))

const { status } = spawnSync('playwright', ['test', ...rest], {
	stdio: 'inherit',
	env: { ...process.env, MOCKUP_FIDELITY: mode }
})

// `status` is null when the child was killed by a signal — treat that as failure.
process.exit(status ?? 1)
