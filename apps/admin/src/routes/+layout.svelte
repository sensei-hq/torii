<script>
	import 'uno.css'
	import '../app.css'
	import { vibe } from '@rokkit/states'
	import { themable } from '@rokkit/actions'

	let { children } = $props()
</script>

<svelte:body use:themable={{ theme: vibe, storageKey: 'seiki-admin-theme' }} />

{@render children()}
