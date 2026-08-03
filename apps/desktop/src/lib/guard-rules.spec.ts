import { describe, expect, test } from 'vitest'
import { deriveGuardRules } from './guard-rules'

// The exact glob keys the root layout feeds in (import.meta.glob('./**/+page.svelte')).
const PAGE_KEYS = [
	'./(app)/+page.svelte',
	'./(app)/activity/+page.svelte',
	'./(app)/ask/+page.svelte',
	'./(app)/compare/+page.svelte',
	'./(app)/library/+page.svelte',
	'./(app)/models/+page.svelte',
	'./(app)/playground/+page.svelte',
	'./(app)/settings/+page.svelte',
	'./(app)/workflows/+page.svelte',
	'./signin/+page.svelte'
]

describe('deriveGuardRules', () => {
	const byPath = () => Object.fromEntries(deriveGuardRules(PAGE_KEYS).map((r) => [r.path, r]))

	test('EVERY shipped (app) route is a member-authenticated rule (H3 regression lock)', () => {
		const rules = byPath()
		for (const path of [
			'/',
			'/activity',
			'/ask',
			'/compare', // was missing → bounced to /signin
			'/library',
			'/models', // was missing → bounced to /signin
			'/playground',
			'/settings',
			'/workflows'
		]) {
			expect(rules[path], `missing guard rule for ${path}`).toEqual({ path, roles: '*' })
		}
	})

	test('/signin is public (never gated)', () => {
		expect(byPath()['/signin']).toEqual({ path: '/signin', public: true })
	})

	test('the (app) index maps to "/" and route-group parens never leak into a path', () => {
		const rules = deriveGuardRules(PAGE_KEYS)
		expect(rules.some((r) => r.path === '/')).toBe(true)
		for (const r of rules) expect(r.path).not.toMatch(/[()]/)
	})

	test('a brand-new (app) screen is covered automatically (no hand-maintenance)', () => {
		const rules = deriveGuardRules(['./(app)/brand-new/+page.svelte'])
		expect(rules).toEqual([{ path: '/brand-new', roles: '*' }])
	})
})
