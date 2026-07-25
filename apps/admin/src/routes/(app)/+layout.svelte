<script>
	import { setContext, onMount } from 'svelte'
	import { page } from '$app/state'
	import { invalidateAll, goto } from '$app/navigation'
	import { api } from '$lib/api'

	let { children } = $props()
	let ready = $state(false)

	const kavach = $state({})
	setContext('kavach', kavach)

	// Real shell identity for AppShell's top bar (replaces the mock "Aiko · Administrator").
	// A $state object shared via context so the async identity fetch updates the shell
	// reactively; AppShell reads `adminShell` and prefers it over its prop defaults.
	const shell = $state({
		/** @type {{ name: string; initial: string; role: string } | null} */
		user: null,
		onSignout: async () => {
			await api.signOut()
			// Hard nav (not goto): signOut fires Supabase onAuthStateChange → the kavach
			// adapter's invalidateAll re-runs the root load and cancels a client-side goto.
			// A full load to /signin (now public) tears down all in-memory state cleanly.
			window.location.assign('/signin')
		}
	})
	setContext('adminShell', shell)

	onMount(async () => {
		// Client-side auth guard: no Supabase session → sign in (runs first so a
		// missing/failed kavach adapter can't leave the app unguarded).
		if (!(await api.hasSession())) {
			goto('/signin')
			return
		}
		ready = true
		// Best-effort real identity — the shell renders regardless of this resolving.
		try {
			const { email, role } = await api.identity()
			if (email)
				shell.user = { name: email, initial: email[0].toUpperCase(), role: role ?? '' }
		} catch {
			/* shell falls back to a neutral label */
		}
		try {
			const { createKavach } = await import('kavach')
			const { adapter, logger } = await import('$kavach/auth')
			Object.assign(kavach, createKavach(adapter, { logger, invalidateAll }))
			kavach.onAuthChange(page.url)
		} catch (e) {
			console.warn('kavach init skipped:', e)
		}
	})
</script>

{#if ready}
	{@render children()}
{/if}
