import { beforeEach, expect, test, vi } from 'vitest'
import { createGuard, type Rule } from './guard'

// guard.ts is a thin adapter: rules + options go into @kavach/sentry's factory,
// protect() feeds setSession(session ?? undefined) then returns sentry.protect(path).
// Mock the sentry so we assert OUR contract, not kavach's internals.
vi.mock('@kavach/sentry', () => ({
	createSentry: vi.fn(() => ({
		setSession: vi.fn(),
		protect: vi.fn(() => ({ status: 302, redirect: '/signin' }))
	}))
}))

import { createSentry } from '@kavach/sentry'

const rules: Rule[] = [
	{ path: '/', public: true },
	{ path: '/app', roles: ['admin', 'member'] }
]

beforeEach(() => {
	vi.mocked(createSentry).mockClear()
})

test('createGuard forwards rules and login/home options to the sentry factory', () => {
	createGuard(rules)
	expect(createSentry).toHaveBeenCalledOnce()
	const [opts] = vi.mocked(createSentry).mock.calls[0]
	expect(opts).toEqual({
		app: { login: '/signin', home: '/' },
		rules
	})
})

test('custom login/home override the defaults', () => {
	createGuard(rules, { login: '/auth/login', home: '/dashboard' })
	const [opts] = vi.mocked(createSentry).mock.calls[0]
	expect(opts).toMatchObject({ app: { login: '/auth/login', home: '/dashboard' } })
})

test('protect passes the session through and returns the sentry verdict', () => {
	const guard = createGuard(rules)
	const verdict = guard.protect('/app', { user: { role: 'admin' } })

	const instance = vi.mocked(createSentry).mock.results[0].value
	expect(instance.setSession).toHaveBeenCalledWith({ user: { role: 'admin' } })
	expect(instance.protect).toHaveBeenCalledWith('/app')
	expect(verdict).toEqual({ status: 302, redirect: '/signin' })
})

test('protect with a null session clears it (undefined) before checking', () => {
	const guard = createGuard(rules)
	guard.protect('/app', null)

	const instance = vi.mocked(createSentry).mock.results[0].value
	expect(instance.setSession).toHaveBeenCalledWith(undefined)
})
