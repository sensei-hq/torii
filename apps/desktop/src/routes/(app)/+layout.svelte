<script>
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { DesktopShell } from '@torii/ui'
	import { session } from '@torii/core'

	let { children } = $props()
	const user = $derived(session.user ?? { name: 'Member', role: 'member' })

	/** @param {string} href */
	function nav(href) {
		goto(resolve(href))
	}
	async function signout() {
		await session.signOut()
		goto(resolve('/signin'))
	}
</script>

<DesktopShell {user} version={1} localModels={0} onnavigate={nav} onsignout={signout}>
	{@render children()}
</DesktopShell>
