import { describe, it, expect } from 'vitest'
import { parseMockupFidelityArgs, resolveMockups } from './mockups'

// The design mockups are untracked (see .gitignore) — exported from the claude.ai design
// project into docs/mockups/. The fidelity harness diffs the app against them, so it is a
// LOCAL DEVELOPMENT tool with three modes:
//
//   bun run e2e                              → 'off'  · fidelity excluded, e2e runs
//   bun run e2e --with-mockup-fidelity       → 'with' · included when present; when the
//                                              export is missing, e2e STILL RUNS without it
//   bun run mockup-fidelity                  → 'only' · fidelity alone; missing export is
//                                              a hard error, because it is the whole point
//
// The asymmetry is deliberate: "e2e plus a bonus" must not be broken by a missing bonus,
// but "run exactly this" must not silently run nothing.

const BASE = '/repo/apps/admin'
const present = () => true
const absent = () => false

describe('parseMockupFidelityArgs', () => {
	it('defaults to off with no flags', () => {
		expect(parseMockupFidelityArgs([])).toEqual({ mode: 'off', rest: [] })
	})

	it('reads --with-mockup-fidelity and strips it from the args', () => {
		expect(parseMockupFidelityArgs(['--with-mockup-fidelity'])).toEqual({ mode: 'with', rest: [] })
	})

	it('reads --only-mockup-fidelity and strips it from the args', () => {
		expect(parseMockupFidelityArgs(['--only-mockup-fidelity'])).toEqual({ mode: 'only', rest: [] })
	})

	it('passes every other arg through to playwright untouched', () => {
		expect(parseMockupFidelityArgs(['--headed', '--with-mockup-fidelity', '-g', 'spend'])).toEqual({
			mode: 'with',
			rest: ['--headed', '-g', 'spend']
		})
	})

	it('lets the more specific --only win over --with', () => {
		expect(parseMockupFidelityArgs(['--with-mockup-fidelity', '--only-mockup-fidelity']).mode).toBe(
			'only'
		)
	})
})

describe('resolveMockups', () => {
	it('is disabled in off mode even when an export is present', () => {
		const r = resolveMockups('off', {}, present, BASE)
		expect(r.enabled).toBe(false)
	})

	it('names the opt-in flag when disabled', () => {
		const r = resolveMockups('off', {}, present, BASE)
		if (!r.enabled) expect(r.reason).toMatch(/--with-mockup-fidelity/)
		else throw new Error('expected disabled')
	})

	// 'with' + missing export → e2e still runs, fidelity dropped. The load-bearing case.
	it('degrades to disabled — not an error — when opted in without an export', () => {
		const r = resolveMockups('with', {}, absent, BASE)
		expect(r.enabled).toBe(false)
	})

	it('explains the degrade so the skip is not silent', () => {
		const r = resolveMockups('with', {}, absent, BASE)
		if (!r.enabled) expect(r.reason).toMatch(/docs\/mockups/)
		else throw new Error('expected disabled')
	})

	it('enables and resolves the default export directory in with mode', () => {
		const r = resolveMockups('with', {}, present, BASE)
		expect(r.enabled).toBe(true)
		if (r.enabled) {
			expect(r.dir).toBe('/repo/docs/mockups')
			expect(r.onlyFidelity).toBe(false)
		}
	})

	it('restricts the run to fidelity in only mode', () => {
		const r = resolveMockups('only', {}, present, BASE)
		if (r.enabled) expect(r.onlyFidelity).toBe(true)
		else throw new Error('expected enabled')
	})

	// 'only' + missing export → hard error. Running zero tests and exiting 0 would read as a pass.
	it('bails in only mode when the export is missing', () => {
		expect(() => resolveMockups('only', {}, absent, BASE)).toThrow(/docs\/mockups/)
	})

	it('names the override in the bail message, so the fix is obvious', () => {
		expect(() => resolveMockups('only', {}, absent, BASE)).toThrow(/MOCKUPS_DIR/)
	})

	it('reports the path it actually looked at when bailing on an override', () => {
		expect(() => resolveMockups('only', { MOCKUPS_DIR: '/nope' }, absent, BASE)).toThrow(/\/nope/)
	})

	it('resolves a relative MOCKUPS_DIR against the config directory', () => {
		const r = resolveMockups('with', { MOCKUPS_DIR: '../../tmp/export' }, present, BASE)
		if (r.enabled) expect(r.dir).toBe('/repo/tmp/export')
		else throw new Error('expected enabled')
	})

	it('honours an absolute MOCKUPS_DIR as given', () => {
		const r = resolveMockups('with', { MOCKUPS_DIR: '/elsewhere/mockups' }, present, BASE)
		if (r.enabled) expect(r.dir).toBe('/elsewhere/mockups')
		else throw new Error('expected enabled')
	})

	it('ignores a blank MOCKUPS_DIR and falls back to the default', () => {
		const r = resolveMockups('with', { MOCKUPS_DIR: '   ' }, present, BASE)
		if (r.enabled) expect(r.dir).toBe('/repo/docs/mockups')
		else throw new Error('expected enabled')
	})

	it('defaults to port 8890 and serves Seiki.html', () => {
		const r = resolveMockups('with', {}, present, BASE)
		if (r.enabled) {
			expect(r.port).toBe(8890)
			expect(r.url).toBe('http://localhost:8890/Seiki.html')
		} else throw new Error('expected enabled')
	})

	it('honours MOCKUPS_PORT in both the port and the url', () => {
		const r = resolveMockups('with', { MOCKUPS_PORT: '9001' }, present, BASE)
		if (r.enabled) {
			expect(r.port).toBe(9001)
			expect(r.url).toBe('http://localhost:9001/Seiki.html')
		} else throw new Error('expected enabled')
	})

	it('rejects a non-numeric MOCKUPS_PORT rather than serving on NaN', () => {
		expect(() => resolveMockups('with', { MOCKUPS_PORT: 'abc' }, present, BASE)).toThrow(
			/MOCKUPS_PORT/
		)
	})
})
