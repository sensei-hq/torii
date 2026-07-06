<script>
	import 'uno.css'
	import '../app.css'
	import { onMount, setContext } from 'svelte'
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { page } from '$app/state'
	import { vibe } from '@rokkit/states'
	import { themable } from '@rokkit/actions'
	import { createStrategosKavach, session, createGuard } from '@strategos/core'
	import { SUPABASE_URL, SUPABASE_ANON_KEY } from '$lib/env'

	let { children } = $props()

	const rules = [
		{ path: '/signin', public: true },
		{ path: '/', roles: '*' }
	]
	const guard = createGuard(rules, { login: '/signin', home: '/' })
	const sk = createStrategosKavach(SUPABASE_URL, SUPABASE_ANON_KEY)
	setContext('kavach', sk.kavach)

	function check(path) {
		if (!session.ready) return
		const r = guard.protect(path, session.user ? { user: { role: session.role } } : null)
		if (r.status !== 200 && r.redirect && r.redirect !== path)
			goto(resolve(typeof r.redirect === 'function' ? r.redirect() : r.redirect))
	}

	onMount(async () => {
		await session.init(sk)
		check(page.url.pathname)
	})

	$effect(() => {
		if (session.ready) check(page.url.pathname)
	})
</script>

<svelte:body use:themable={{ theme: vibe, storageKey: 'strategos-desktop-theme' }} />
{@render children()}
