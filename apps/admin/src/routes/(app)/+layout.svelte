<script>
	import { setContext, onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { api } from '$lib/api'

	let { children } = $props()
	let ready = $state(false)

	// Real shell identity for AppShell's top bar (replaces the mock "Aiko · Administrator").
	// A $state object shared via context so the async identity fetch updates the shell
	// reactively; AppShell reads `adminShell` and prefers it over its prop defaults.
	const shell = $state({
		/** @type {{ name: string; initial: string; role: string } | null} */
		user: null,
		/** @type {{ mark: string; name: string; sub: string } | null} */
		org: null,
		onSignout: async () => {
			await api.signOut()
			// Hard nav (not goto): a full load to /signin (public) tears down all in-memory
			// auth state cleanly and avoids any client-nav race with the sign-out event.
			window.location.assign('/signin')
		}
	})
	setContext('adminShell', shell)

	onMount(async () => {
		// Client-side auth guard: no Supabase session → sign in. (The admin's session is
		// managed entirely by api.ts's supabase-js client; the server hooks.server.js
		// kavach handle enforces route rules — no client kavach instance is needed here.)
		if (!(await api.hasSession())) {
			goto('/signin')
			return
		}
		ready = true
		// Best-effort real identity — the shell renders regardless of this resolving.
		try {
			const { email, role, org } = await api.identity()
			if (email)
				shell.user = { name: email, initial: email[0].toUpperCase(), role: role ?? '' }
			if (org) shell.org = { mark: org[0].toUpperCase(), name: org, sub: 'organization' }
		} catch {
			/* shell falls back to a neutral label */
		}
	})
</script>

{#if ready}
	{@render children()}
{/if}
