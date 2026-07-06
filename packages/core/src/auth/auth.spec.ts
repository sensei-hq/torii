import { expect, test } from 'vitest'
import { createGuard } from './guard'

const rules = [
	{ path: '/signin', public: true },
	{ path: '/', roles: '*' },
	{ path: '/admin', roles: ['admin'] }
]

test('guard redirects anonymous users away from a private route', () => {
	const g = createGuard(rules)
	const r = g.protect('/', null)
	expect(r.status).not.toBe(200)
	expect(r.redirect).toBeTruthy()
})

test('guard allows an authenticated member to the home route', () => {
	const g = createGuard(rules)
	expect(g.protect('/', { user: { role: 'member' } }).status).toBe(200)
})

test('guard forbids a member from an admin-only route', () => {
	const g = createGuard(rules)
	expect(g.protect('/admin', { user: { role: 'member' } }).status).not.toBe(200)
})
