<script>
	import { env } from './env.svelte.js'
</script>

<button
	type="button"
	onclick={() => env.cycle()}
	data-env-chip
	data-mode={env.mode}
	class="inline-flex items-center gap-1 rounded-full border border-paper-edge px-2 py-0.5 text-xs text-ink-soft"
>
	<span
		class={env.offline
			? 'i-lucide:cloud-off h-3 w-3'
			: env.web
				? 'i-lucide:globe h-3 w-3'
				: 'i-lucide:monitor h-3 w-3'}
	></span>
	{env.mode}
</button>
