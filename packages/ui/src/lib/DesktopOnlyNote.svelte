<script>
	import { env } from './env.svelte.js'
</script>

{#if env.web}
	<span data-desktop-only class="text-xs text-ink-mute">Needs the desktop app</span>
{/if}
