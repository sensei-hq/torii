<script>
	import { env } from './env.svelte.js'

	let { synced = true, configVersion = 0, localModels = 0, offlineBuffer = 0 } = $props()
</script>

<div
	data-device-footer
	class="flex items-center gap-3 border-t border-paper-edge bg-paper-mute px-3 py-1 text-xs text-ink-mute"
>
	<span>
		{#if env.offline || !synced}
			○ offline
		{:else}
			● synced · config v{configVersion}
		{/if}
	</span>
	<span>{localModels} on device</span>
	{#if offlineBuffer > 0}
		<span>{offlineBuffer} queued</span>
	{/if}
</div>
