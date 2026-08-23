import { beforeEach, expect, test, vi } from 'vitest'
import type { ToriiKavach } from './client'
import { session, type SessionUser } from './session.svelte'

// Fake ToriiKavach: only the `client.auth` surface SessionStore touches. The
// onAuthStateChange mock captures its callback so tests can push session events.
function makeSk(initial: unknown = null) {
	let handler: ((event: string, s: unknown) => void) | undefined
	const auth = {
		getSession: vi.fn(async () => ({ data: { session: initial } })),
		onAuthStateChange: vi.fn((cb: (event: string, s: unknown) => void) => {
			handler = cb
			return { data: { subscription: { unsubscribe() {} } } }
		}),
		signInWithPassword: vi.fn(async (...args: unknown[]) => ({ args, data: {}, error: null })),
		signInWithOtp: vi.fn(async (...args: unknown[]) => ({ args, data: {}, error: null })),
		verifyOtp: vi.fn(async (...args: unknown[]) => ({ args, data: {}, error: null })),
		resetPasswordForEmail: vi.fn(async (...args: unknown[]) => ({ args, data: {}, error: null })),
		signOut: vi.fn(async () => ({}))
	}
	return {
		sk: { client: { auth }, kavach: {} } as unknown as ToriiKavach,
		auth,
		emit: (event: string, s: unknown) => handler?.(event, s)
	}
}

function makeSession(overrides: Record<string, unknown> = {}) {
	return {
		access_token: 'tok-123',
		user: {
			id: 'u-1',
			email: 'jerry@torii.dev',
			app_metadata: {},
			user_metadata: {},
			...overrides
		}
	}
}

beforeEach(() => {
	// Reset the singleton through its own hydration path: an empty sk leaves
	// user/accessToken cleared and ready=true.
	const { sk } = makeSk(null)
	session.ready = false
	return session.init(sk)
})

test('starts anonymous and unready', () => {
	expect(session.ready).toBe(true) // beforeEach hydrated
	expect(session.user).toBeNull()
	expect(session.accessToken).toBeNull()
	expect(session.authenticated).toBe(false)
	expect(session.role).toBe('anon')
})

test('init hydrates from the persisted supabase session and subscribes', async () => {
	const { sk, auth } = makeSk(
		makeSession({ app_metadata: { role: 'admin' }, user_metadata: { name: 'Jerry' } })
	)
	await session.init(sk)
	expect(auth.getSession).toHaveBeenCalledOnce()
	expect(auth.onAuthStateChange).toHaveBeenCalledOnce()
	expect(session.ready).toBe(true)
	expect(session.authenticated).toBe(true)
	expect(session.user?.role).toBe('admin')
	expect(session.user?.name).toBe('Jerry')
	expect(session.accessToken).toBe('tok-123')
})

test('role defaults to member and name falls back to email', async () => {
	const { sk } = makeSk(makeSession())
	await session.init(sk)
	expect(session.user?.role).toBe('member')
	expect(session.user?.name).toBe('jerry@torii.dev')
})

test('a bare session without metadata/token still maps safely', async () => {
	// No app_metadata, no user_metadata, no access_token — exercises the
	// `?? {}` / `?? null` fallback branches in #apply.
	const { sk } = makeSk({ user: { id: 'u-2', email: 'bare@torii.dev' } })
	await session.init(sk)
	expect(session.user?.role).toBe('member')
	expect(session.user?.name).toBe('bare@torii.dev')
	expect(session.accessToken).toBeNull()
})

test('init without a stored session stays anonymous but ready', async () => {
	const { sk } = makeSk(null)
	await session.init(sk)
	expect(session.ready).toBe(true)
	expect(session.authenticated).toBe(false)
})

test('onAuthStateChange events apply and clear the session', async () => {
	const { sk, emit } = makeSk(makeSession())
	await session.init(sk)
	expect(session.authenticated).toBe(true)

	emit('SIGNED_OUT', null)
	expect(session.user).toBeNull()
	expect(session.accessToken).toBeNull()

	emit('SIGNED_IN', makeSession({ app_metadata: { role: 'owner' } }))
	const user: SessionUser | null = session.user
	expect(user?.role).toBe('owner')
	expect(session.role).toBe('owner')
	expect(user?.id).toBe('u-1')
})

test('credential methods delegate to client.auth after init', async () => {
	const { sk, auth } = makeSk(null)
	await session.init(sk)

	await session.signInWithPassword('a@b.c', 'pw')
	expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' })

	await session.signInWithOtp('a@b.c')
	expect(auth.signInWithOtp).toHaveBeenCalledWith({
		email: 'a@b.c',
		options: { shouldCreateUser: true }
	})

	await session.verifyOtp('a@b.c', '123456')
	expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'a@b.c', token: '123456', type: 'email' })

	await session.resetPasswordForEmail('a@b.c')
	expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.c')

	await session.signOut()
	expect(auth.signOut).toHaveBeenCalledOnce()
})

// `#sk` is private and never cleared, so the un-initialised throw paths are only
// reachable on a pristine module instance — load one via resetModules.
test('credential methods throw before init', async () => {
	vi.resetModules()
	const { session: pristine } = await import('./session.svelte')
	await expect(pristine.signInWithPassword('a@b.c', 'pw')).rejects.toThrow(
		'session not initialised'
	)
	await expect(pristine.signInWithOtp('a@b.c')).rejects.toThrow('session not initialised')
	await expect(pristine.verifyOtp('a@b.c', '123456')).rejects.toThrow('session not initialised')
	await expect(pristine.resetPasswordForEmail('a@b.c')).rejects.toThrow('session not initialised')
})

test('signOut before init is a safe no-op', async () => {
	vi.resetModules()
	const { session: pristine } = await import('./session.svelte')
	await expect(pristine.signOut()).resolves.toBeUndefined()
})
