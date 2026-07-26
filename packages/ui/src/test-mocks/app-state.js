// Test-only mock of SvelteKit's `$app/state` virtual module. @torii/ui is a
// component library consumed by SvelteKit apps (which provide `$app/*` at
// runtime); in isolated vitest we alias these imports here. Components only read
// `page.url.pathname` for active-nav detection.
export const page = {
	url: new URL('http://localhost/'),
	params: {},
	route: { id: null },
	status: 200,
	error: null,
	data: {},
	form: null
}
export const navigating = { from: null, to: null, type: null }
export const updated = { current: false, check: async () => false }
