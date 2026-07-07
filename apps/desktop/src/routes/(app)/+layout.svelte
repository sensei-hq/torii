<script>
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { page } from '$app/state'
	import { DesktopShell } from '@strategos/ui'
	import { session } from '@strategos/core'

	let { children } = $props()
	const items = [
		'Workspace',
		'Ask',
		'Library',
		'Playground',
		'Workflows',
		'Activity',
		'Models',
		'Settings'
	]
	const active = $derived(
		items.find((i) => page.url.pathname.replace(/^\//, '') === i.toLowerCase()) ?? 'Workspace'
	)
	const user = $derived(session.user ?? { name: 'Member', role: 'member' })

	function nav(item) {
		goto(resolve(item === 'Workspace' ? '/' : `/${item.toLowerCase()}`))
	}
	async function signout() {
		await session.signOut()
		goto(resolve('/signin'))
	}
</script>

<DesktopShell
	{user}
	{items}
	{active}
	version={1}
	localModels={0}
	onnavigate={nav}
	onsignout={signout}
>
	{@render children()}
</DesktopShell>
