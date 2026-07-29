export default {
	adapter: 'supabase',
	env: { url: 'PUBLIC_SUPABASE_URL', anonKey: 'PUBLIC_SUPABASE_ANON_KEY' },
	providers: [
		{ name: 'github', label: 'Continue with GitHub' },
		{ name: 'google', label: 'Continue with Google' },
		{ mode: 'password', name: 'password', label: 'Email & password' }
	],
	logging: { level: 'error', table: 'audit_events' },
	routes: { auth: '/signin', data: '/data', logout: '/logout', home: '/' },
	rules: [
		{ path: '/signin', public: true }, // the real login page — auth redirects land here, not a 404 /auth
		{ path: '/auth/callback', public: true }, // magic-link + OAuth return; not auth-guarded (would loop)
		{ path: '/', public: true } // Phase 0: shell boots publicly. Phase 1 tightens to roles:'*' + server-side session.
	]
}
