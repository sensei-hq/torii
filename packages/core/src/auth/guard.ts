import { createSentry } from '@kavach/sentry'

export interface Rule {
	path: string
	public?: boolean
	roles?: string | string[]
}

interface GuardOptions {
	login: string
	home: string
}

// The @kavach/sentry type declarations are stale: SentryOptions uses `roles` but the
// implementation reads `rules`, and the returned Sentry typedef has `redirect` not `protect`.
// We cast to the real runtime shapes to avoid fighting the outdated declarations.
interface SentryInstance {
	setSession(session?: { user?: { role?: string } } | undefined): void
	protect(path: string): { status: number; redirect?: unknown }
}

// Client-side guard: given the rules + current role, decide access for a path.
// Mirrors kavach's server sentry but runs in the SPA (no locals.session).
export function createGuard(rules: Rule[], opts: GuardOptions = { login: '/signin', home: '/' }) {
	// Cast to any: @kavach/sentry types declare `roles` but the runtime reads `rules`,
	// and `processAppRoutes` fills in missing AppRoute fields (logout, session, endpoints).
	const sentry = createSentry({ app: opts as any, rules } as any) as unknown as SentryInstance
	return {
		protect(path: string, session: { user: { role: string } } | null) {
			sentry.setSession(session ?? undefined)
			return sentry.protect(path) // { status, redirect? }
		}
	}
}
