// Route-guard allowlist derived from the route tree, so a newly-added screen can't silently
// break navigation (code-review H3: /compare + /models shipped in the nav but were missing from
// a hand-maintained rules array → bounced to /signin). Pure + string-only so it's unit-testable
// without importing the @kavach-backed guard runtime.

/** A route guard rule — structurally compatible with @torii/core's `Rule`. */
export interface GuardRule {
	path: string
	public?: boolean
	roles?: string | string[]
}

/**
 * Map a set of `+page.svelte` glob keys (relative to `src/routes`, e.g. `./(app)/compare/+page.svelte`)
 * to guard rules. Route groups `(…)` are transparent in the URL and stripped; the `(app)` index
 * becomes `/`. `/signin` is public; every other page is member-authenticated (`roles: '*'`).
 *
 * Wire it in the root layout with `deriveGuardRules(Object.keys(import.meta.glob('./**\/+page.svelte')))`.
 */
export function deriveGuardRules(pageKeys: string[]): GuardRule[] {
	return pageKeys.map((key) => {
		const path =
			'/' +
			key
				.replace('./', '')
				.replace('/+page.svelte', '')
				.replace(/\([^/]+\)\/?/g, '') // route groups don't appear in the URL
		const clean = path.replace(/\/+$/, '') || '/'
		return clean === '/signin' ? { path: clean, public: true } : { path: clean, roles: '*' }
	})
}
