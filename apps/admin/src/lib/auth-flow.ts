import type { WhoAmI } from './api'

/** Lowercased, whitespace-trimmed email. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase()
}

/** Basic shape check: a local part, an '@', and a dotted domain. */
export function looksLikeEmail(email: string): boolean {
	return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmail(email))
}

export type AuthDestination = 'home' | 'no-org'

/**
 * Where to send the user after a completed sign-in: a resolved whoami carrying a
 * tenant_id → the app home; a tenant-less whoami → the no-org state. `null` maps to
 * no-org as a defensive default. The callback handles a *thrown* whoami separately
 * (as a retryable error state), so a failed lookup never routes through here.
 */
export function postAuthDestination(whoami: WhoAmI | null): AuthDestination {
	return whoami?.tenant_id ? 'home' : 'no-org'
}
