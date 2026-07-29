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
 * Where to send the user after a completed sign-in. A resolved whoami carrying a
 * tenant_id → the app home; a tenant-less whoami OR a failed lookup (null) → the
 * no-org state. The callback passes `null` when whoami throws, so this is the one
 * branch point for both magic-link and OAuth returns.
 */
export function postAuthDestination(whoami: WhoAmI | null): AuthDestination {
	return whoami?.tenant_id ? 'home' : 'no-org'
}
