<script>
	import { setContext, onMount } from 'svelte'
	import { page } from '$app/state'
	import { invalidateAll, goto } from '$app/navigation'
	import { api } from '$lib/api'

	let { children } = $props()
	let ready = $state(false)

	const kavach = $state({})
	setContext('kavach', kavach)

	onMount(async () => {
		// Client-side auth guard: no Supabase session → sign in (runs first so a
		// missing/failed kavach adapter can't leave the app unguarded).
		if (!(await api.hasSession())) {
			goto('/signin')
			return
		}
		ready = true
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
