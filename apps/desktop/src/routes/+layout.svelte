<script>
	import 'uno.css'
	import '../app.css'
	import { onMount, setContext } from 'svelte'
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { page } from '$app/state'
	import { vibe } from '@rokkit/states'
	import { themable } from '@rokkit/actions'
	import { createToriiKavach, session, createGuard } from '@torii/core'
	import { SUPABASE_URL, SUPABASE_ANON_KEY } from '$lib/env'

	let { children } = $props()

	const rules = [
		{ path: '/signin', public: true },
		{ path: '/', roles: '*' },
		{ path: '/ask', roles: '*' },
		{ path: '/library', roles: '*' },
		{ path: '/playground', roles: '*' },
		{ path: '/workflows', roles: '*' },
		{ path: '/activity', roles: '*' },
		{ path: '/settings', roles: '*' }
	]
	const guard = createGuard(rules, { login: '/signin', home: '/' })
	const sk = createToriiKavach(SUPABASE_URL, SUPABASE_ANON_KEY)
	setContext('kavach', sk.kavach)

	function check(path) {
		if (!session.ready) return
		const r = guard.protect(path, session.user ? { user: { role: session.role } } : null)
		if (r.status !== 200 && r.redirect && r.redirect !== path)
			goto(resolve(typeof r.redirect === 'function' ? r.redirect() : r.redirect))
	}

	onMount(async () => {
		if (import.meta.env.VITE_E2E === 'true') {
			// E2E only: deterministic seeded session, no network. Never true in production builds.
			session.ready = true
			session.user = { id: 'e2e', email: 'e2e@strategos.test', name: 'E2E Member', role: 'member' }
		} else {
			await session.init(sk)
		}
		check(page.url.pathname)
	})

	$effect(() => {
		if (session.ready) check(page.url.pathname)
	})
</script>

<svelte:body use:themable={{ theme: vibe, storageKey: 'strategos-desktop-theme' }} />
{@render children()}
