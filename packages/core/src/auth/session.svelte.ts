import type { ToriiKavach } from './client'

export interface SessionUser {
	id: string
	email?: string
	name?: string
	role: string
}

class SessionStore {
	ready = $state(false)
	user = $state<SessionUser | null>(null)
	accessToken = $state<string | null>(null)

	get authenticated() {
		return this.user !== null
	}
	get role() {
		return this.user?.role ?? 'anon'
	}

	#sk: ToriiKavach | null = null

	// Hydrate from the persisted supabase session, then subscribe to changes.
	async init(sk: ToriiKavach) {
		this.#sk = sk
		const { data } = await sk.client.auth.getSession()
		this.#apply(data.session)
		sk.client.auth.onAuthStateChange((_event, session) => this.#apply(session))
		this.ready = true
	}

	#apply(session: unknown) {
		// Supabase Session | null. Claims (role/tenant) come from app_metadata via the JWT hook.
		const s = session as {
			access_token?: string
			user?: {
				id: string
				email?: string
				app_metadata?: Record<string, unknown>
				user_metadata?: Record<string, unknown>
			}
		} | null
		if (!s?.user) {
			this.user = null
			this.accessToken = null
			return
		}
		const app = s.user.app_metadata ?? {}
		this.user = {
			id: s.user.id,
			email: s.user.email,
			name: (s.user.user_metadata?.name as string) ?? s.user.email,
			role: (app.role as string) ?? 'member'
		}
		this.accessToken = s.access_token ?? null
	}

	async signInWithPassword(email: string, password: string) {
		if (!this.#sk) throw new Error('session not initialised')
		return this.#sk.client.auth.signInWithPassword({ email, password })
	}

	/**
	 * Passwordless PRIMARY (DECISIONS §10.2): email a one-time sign-in code (+ magic link).
	 * `shouldCreateUser` makes this the REGISTRATION path too — a new work-email is provisioned
	 * on first sign-in. Desktop uses the 6-digit CODE (verifyOtp) rather than the link, so no
	 * `torii://` deep-link handler is required.
	 */
	async signInWithOtp(email: string) {
		if (!this.#sk) throw new Error('session not initialised')
		return this.#sk.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
	}

	/** Verify the emailed one-time code → establishes the session (magic-link/OTP completion). */
	async verifyOtp(email: string, token: string) {
		if (!this.#sk) throw new Error('session not initialised')
		return this.#sk.client.auth.verifyOtp({ email, token, type: 'email' })
	}

	/** Send a password-reset email (secondary path recovery — DECISIONS §10.2). */
	async resetPasswordForEmail(email: string) {
		if (!this.#sk) throw new Error('session not initialised')
		return this.#sk.client.auth.resetPasswordForEmail(email)
	}

	async signOut() {
		await this.#sk?.client.auth.signOut()
	}
}

export const session = new SessionStore()
