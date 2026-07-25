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
			? 'i-solar-cloud-cross-bold-duotone h-3 w-3'
			: env.web
				? 'i-solar-global-bold-duotone h-3 w-3'
				: 'i-solar-monitor-bold-duotone h-3 w-3'}
	></span>
	{env.mode}
</button>
