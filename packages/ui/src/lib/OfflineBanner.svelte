<script>
	import { env } from './env.svelte.js'

	let dismissed = $state(false)
</script>

{#if env.offline && !dismissed}
	<div
		data-offline-banner
		class="flex items-center justify-between border-b border-paper-edge bg-paper-mute px-4 py-2 text-sm text-ink-soft"
	>
		<span>Cloud unreachable — local models still work.</span>
		<button
			type="button"
			onclick={() => (dismissed = true)}
			class="ml-4 text-xs text-ink-mute hover:text-ink-soft"
		>
			Dismiss
		</button>
	</div>
{/if}
