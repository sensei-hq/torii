<script>
	let { label, tone = 'ink', icon = null } = $props()
</script>

<span
	data-pill
	data-tone={tone}
	class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
>
	{#if icon}<span class={`i-lucide:${icon} h-3 w-3`}></span>{/if}
	{label}
</span>
