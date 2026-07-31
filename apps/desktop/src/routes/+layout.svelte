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
	import { deriveGuardRules } from '$lib/guard-rules'
	import { SUPABASE_URL, SUPABASE_ANON_KEY } from '$lib/env'

	let { children } = $props()

	// Allowlist DERIVED from the route tree (H3) — a hand-maintained list silently broke nav when
	// /compare + /models were added. Every `+page.svelte` becomes a rule (see deriveGuardRules), so
	// a new screen is guarded the moment its page file exists.
	const rules = deriveGuardRules(Object.keys(import.meta.glob('./**/+page.svelte')))
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
			// Set `user` BEFORE `ready`: flipping `ready` triggers the reactive guard, which
			// would bounce the session if it saw no user yet.
			session.user = { id: 'e2e', email: 'e2e@torii.test', name: 'E2E Member', role: 'member' }
			session.ready = true
		} else {
			await session.init(sk)
		}
		check(page.url.pathname)
	})

	$effect(() => {
		if (session.ready) check(page.url.pathname)
	})
</script>

<svelte:body use:themable={{ theme: vibe, storageKey: 'torii-desktop-theme' }} />
{@render children()}
