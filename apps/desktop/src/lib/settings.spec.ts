import { describe, expect, test } from 'vitest'
import {
	CITE_OPTIONS,
	PREF_DEFAULTS,
	THEME_OPTIONS,
	TIER_OPTIONS,
	mergePrefs,
	parsePrefs,
	serializePrefs,
	type Prefs
} from './settings'

// These assert the CONTRACT the persistence + segmented-control consumers rely on, not the
// current output: (1) an old/partial/corrupt stored blob must always resolve to a VALID Prefs
// so a segmented control never renders with no selected segment; (2) prefs round-trip through
// storage unchanged; (3) every default has a matching option to render.

const custom: Prefs = {
	tier: 'frontier',
	cites: 'full',
	retention: true,
	autotune: true,
	digest: false,
	autosave: false
}

describe('mergePrefs — forward-compatible, self-healing validation', () => {
	test('an empty / nullish blob yields the full defaults (first run)', () => {
		expect(mergePrefs({})).toEqual(PREF_DEFAULTS)
		expect(mergePrefs(null)).toEqual(PREF_DEFAULTS)
		expect(mergePrefs(undefined)).toEqual(PREF_DEFAULTS)
		expect(mergePrefs('not-an-object')).toEqual(PREF_DEFAULTS)
	})

	test('a PARTIAL blob (pref added after it was written) backfills the missing key', () => {
		// Older storage had only `tier`; the newer `autosave`/`digest` keys must default in.
		const merged = mergePrefs({ tier: 'fast' })
		expect(merged.tier).toBe('fast')
		expect(merged.digest).toBe(PREF_DEFAULTS.digest)
		expect(merged.autosave).toBe(PREF_DEFAULTS.autosave)
	})

	test('an OUT-OF-RANGE enum value falls back to its default (never an unrenderable state)', () => {
		const merged = mergePrefs({ tier: 'ludicrous', cites: 42 })
		expect(merged.tier).toBe(PREF_DEFAULTS.tier)
		expect(merged.cites).toBe(PREF_DEFAULTS.cites)
		// and the surviving value must be one the segmented control can actually select
		expect(TIER_OPTIONS.some((o) => o.value === merged.tier)).toBe(true)
		expect(CITE_OPTIONS.some((o) => o.value === merged.cites)).toBe(true)
	})

	test('a non-boolean toggle value falls back (a truthy string is not "on")', () => {
		const merged = mergePrefs({ retention: 'yes', digest: 0 })
		expect(merged.retention).toBe(PREF_DEFAULTS.retention)
		expect(merged.digest).toBe(PREF_DEFAULTS.digest)
	})

	test('unknown extra keys are dropped — the result carries only known Prefs fields', () => {
		const merged = mergePrefs({ tier: 'fast', evil: '<script>', admin: true }) as Record<
			string,
			unknown
		>
		expect(Object.keys(merged).sort()).toEqual(Object.keys(PREF_DEFAULTS).sort())
		expect('evil' in merged).toBe(false)
	})
})

describe('parsePrefs — resilient storage read', () => {
	test('null / empty raw (first run, cleared storage) → defaults, no throw', () => {
		expect(parsePrefs(null)).toEqual(PREF_DEFAULTS)
		expect(parsePrefs('')).toEqual(PREF_DEFAULTS)
	})

	test('corrupt JSON (hand-edited / truncated) → defaults, no throw', () => {
		expect(parsePrefs('{ not json')).toEqual(PREF_DEFAULTS)
		expect(parsePrefs('null')).toEqual(PREF_DEFAULTS)
	})

	test('valid stored blob is parsed and preserved', () => {
		expect(parsePrefs(JSON.stringify(custom))).toEqual(custom)
	})
})

describe('serialize → parse round-trip (the persistence seam)', () => {
	test('any valid Prefs survives a storage write/read unchanged', () => {
		expect(parsePrefs(serializePrefs(custom))).toEqual(custom)
		expect(parsePrefs(serializePrefs(PREF_DEFAULTS))).toEqual(PREF_DEFAULTS)
	})

	test('serialize never persists junk — an out-of-range field is healed to its default', () => {
		const dirty = { ...custom, tier: 'bogus' } as unknown as Prefs
		expect(JSON.parse(serializePrefs(dirty)).tier).toBe(PREF_DEFAULTS.tier)
	})
})

describe('option catalogs back the controls', () => {
	test('values are unique and non-empty within each catalog', () => {
		for (const cat of [THEME_OPTIONS, TIER_OPTIONS, CITE_OPTIONS]) {
			const values = cat.map((o) => o.value)
			expect(new Set(values).size).toBe(values.length)
			expect(cat.every((o) => o.value.length > 0 && o.label.length > 0)).toBe(true)
		}
	})

	test('every default value is present as a selectable option', () => {
		expect(TIER_OPTIONS.some((o) => o.value === PREF_DEFAULTS.tier)).toBe(true)
		expect(CITE_OPTIONS.some((o) => o.value === PREF_DEFAULTS.cites)).toBe(true)
	})
})
