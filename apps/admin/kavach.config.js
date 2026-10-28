export default {
	adapter: 'supabase',
	env: { url: 'PUBLIC_SUPABASE_URL', anonKey: 'PUBLIC_SUPABASE_ANON_KEY' },
	providers: [
		{ name: 'github', label: 'Continue with GitHub' },
		{ name: 'google', label: 'Continue with Google' },
		{ mode: 'password', name: 'password', label: 'Email & password' }
	],
	logging: { level: 'error', table: 'audit_events' },
	// `session` is the endpoint kavach's own `handle` serves: it validates a posted browser session
	// with Supabase and sets the httpOnly `session` cookie that every later request is judged by.
	// Without it the hook had nothing to serve, so no cookie was ever written and the server could
	// never see a session — the admin's session lives in localStorage, which the server cannot read.
	// `$lib/api.ts` posts to this exact path on every auth event.
	routes: {
		auth: '/signin',
		data: '/data',
		logout: '/logout',
		session: '/auth/session',
		home: '/'
	},
	// Default-deny: kavach admits only the paths below — `public: true`, or a `roles` list the
	// session's role satisfies. Every other path is refused whatever the session looks like: no (or
	// role-less) session → 401 → /signin; a session whose role no rule lists → 403 → `app.unauthorized
	// ?? app.home`. Since `'*'` matches any role, a real session is never 403 on these routes. So
	// listing a route here IS the UI's server-side control; nothing is reachable by accident.
	rules: [
		{ path: '/signin', public: true }, // the real login page — auth redirects land here, not a 404 /auth
		{ path: '/auth/callback', public: true }, // magic-link + OAuth return; not auth-guarded (would loop)
		{ path: '/onboarding', public: true }, // tenant-less users create their org here
		// The admin's screens: any signed-in member (`*` = any role). Before these rules existed the
		// paths were unlisted, so default-deny refused them even with a valid session — a shared
		// run URL, a reload, or a bookmark always landed on sign-in. `roles` admits them; the
		// gateway is still the authority on what a member may see and do (every call carries
		// capabilities), so this is a navigation rule, not an authorization one.
		{ path: '/', roles: '*' }, // the dashboard: same admission as the screens below
		{ path: '/billing', roles: '*' },
		{ path: '/connections', roles: '*' },
		{ path: '/devices', roles: '*' },
		{ path: '/governance', roles: '*' },
		{ path: '/models', roles: '*' },
		{ path: '/organization', roles: '*' },
		{ path: '/rankings', roles: '*' },
		{ path: '/requests', roles: '*' },
		{ path: '/routing', roles: '*' },
		{ path: '/runs', roles: '*' }, // includes /runs/[id] — a rule covers its own subtree
		{ path: '/settings', roles: '*' },
		{ path: '/tools', roles: '*' }
	]
}
