<script>
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { DesktopShell } from '@torii/ui'
	import { session } from '@torii/core'
	import { api } from '$lib/api'

	let { children } = $props()
	const user = $derived(session.user ?? { name: 'Member', role: 'member' })

	// Real workspace name from the gateway (falls back to a neutral label until the
	// gateway exposes tenant_name / until whoami resolves — never a fabricated org).
	let workspace = $state({ mark: 'W', name: 'Workspace', sub: 'workspace' })
	onMount(async () => {
		try {
			const w = await api.whoami()
			if (w.tenant_name)
				workspace = { mark: w.tenant_name[0].toUpperCase(), name: w.tenant_name, sub: 'workspace' }
		} catch {
			/* keep the neutral fallback */
		}
	})

	/** @param {string} href */
	function nav(href) {
		goto(resolve(href))
	}
	async function signout() {
		await session.signOut()
		goto(resolve('/signin'))
	}
</script>

<DesktopShell {user} {workspace} version={1} localModels={0} onnavigate={nav} onsignout={signout}>
	{@render children()}
</DesktopShell>
