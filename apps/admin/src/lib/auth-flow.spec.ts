import { expect, test } from 'vitest'
import { looksLikeEmail, normalizeEmail, postAuthDestination } from './auth-flow'

test('normalizeEmail lowercases and trims', () => {
	expect(normalizeEmail('  Alice@Company.COM ')).toBe('alice@company.com')
})

test('looksLikeEmail accepts dotted work addresses, rejects the rest', () => {
	expect(looksLikeEmail('alice@company.com')).toBe(true)
	expect(looksLikeEmail('alice@localhost')).toBe(false)
	expect(looksLikeEmail('nope')).toBe(false)
	expect(looksLikeEmail('')).toBe(false)
})

test('postAuthDestination: a tenant → home; tenant-less or null → no-org', () => {
	expect(postAuthDestination({ sub: 'u', tenant_id: 't1', role: 'member', capabilities: [] })).toBe(
		'home'
	)
	expect(postAuthDestination({ sub: 'u', tenant_id: null, role: null, capabilities: [] })).toBe(
		'no-org'
	)
	expect(postAuthDestination(null)).toBe('no-org')
})
