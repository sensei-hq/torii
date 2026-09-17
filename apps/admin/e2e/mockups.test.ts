import { describe, it, expect } from 'vitest'
import { resolveMockups } from './mockups'

// The design mockups are untracked (see .gitignore) — exported from the claude.ai design
// project into docs/mockups/. The fidelity harness diffs the app against them, so it is a
// LOCAL DEVELOPMENT tool: off unless explicitly asked for, and a hard error if asked for
// without an export present (rather than a confusing connection-refused at :8890).

const BASE = '/repo/apps/admin'
const present = () => true
const absent = () => false

describe('resolveMockups', () => {
	it('is disabled when fidelity is not requested', () => {
		const r = resolveMockups({}, present, BASE)
		expect(r.enabled).toBe(false)
	})

	it('explains why it is disabled, naming the opt-in switch', () => {
		const r = resolveMockups({}, present, BASE)
		expect(r.enabled).toBe(false)
		if (!r.enabled) expect(r.reason).toMatch(/FIDELITY/)
	})

	it('stays disabled when the export is absent and fidelity was not requested', () => {
		// The common case for everyone who never exports the mockups: silent, not fatal.
		expect(resolveMockups({}, absent, BASE).enabled).toBe(false)
	})

	it('enables and resolves the default export directory when requested', () => {
		const r = resolveMockups({ FIDELITY: '1' }, present, BASE)
		expect(r.enabled).toBe(true)
		if (r.enabled) expect(r.dir).toBe('/repo/docs/mockups')
	})

	it('resolves a relative MOCKUPS_DIR against the config directory', () => {
		const r = resolveMockups({ FIDELITY: '1', MOCKUPS_DIR: '../../tmp/export' }, present, BASE)
		if (r.enabled) expect(r.dir).toBe('/repo/tmp/export')
		else throw new Error('expected enabled')
	})

	it('honours an absolute MOCKUPS_DIR as given', () => {
		const r = resolveMockups({ FIDELITY: '1', MOCKUPS_DIR: '/elsewhere/mockups' }, present, BASE)
		if (r.enabled) expect(r.dir).toBe('/elsewhere/mockups')
		else throw new Error('expected enabled')
	})

	it('ignores a blank MOCKUPS_DIR and falls back to the default', () => {
		const r = resolveMockups({ FIDELITY: '1', MOCKUPS_DIR: '   ' }, present, BASE)
		if (r.enabled) expect(r.dir).toBe('/repo/docs/mockups')
		else throw new Error('expected enabled')
	})

	it('defaults to port 8890 and serves Seiki.html', () => {
		const r = resolveMockups({ FIDELITY: '1' }, present, BASE)
		if (r.enabled) {
			expect(r.port).toBe(8890)
			expect(r.url).toBe('http://localhost:8890/Seiki.html')
		} else throw new Error('expected enabled')
	})

	it('honours MOCKUPS_PORT in both the port and the url', () => {
		const r = resolveMockups({ FIDELITY: '1', MOCKUPS_PORT: '9001' }, present, BASE)
		if (r.enabled) {
			expect(r.port).toBe(9001)
			expect(r.url).toBe('http://localhost:9001/Seiki.html')
		} else throw new Error('expected enabled')
	})

	it('bails when fidelity is requested but the export is missing', () => {
		expect(() => resolveMockups({ FIDELITY: '1' }, absent, BASE)).toThrow(/docs\/mockups/)
	})

	it('names the override in the bail message, so the fix is obvious', () => {
		expect(() => resolveMockups({ FIDELITY: '1' }, absent, BASE)).toThrow(/MOCKUPS_DIR/)
	})

	it('reports the path it actually looked at when bailing on an override', () => {
		expect(() => resolveMockups({ FIDELITY: '1', MOCKUPS_DIR: '/nope' }, absent, BASE)).toThrow(
			/\/nope/
		)
	})

	it('rejects a non-numeric MOCKUPS_PORT rather than serving on NaN', () => {
		expect(() => resolveMockups({ FIDELITY: '1', MOCKUPS_PORT: 'abc' }, present, BASE)).toThrow(
			/MOCKUPS_PORT/
		)
	})
})
