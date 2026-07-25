<script>
	let { plane, region = '' } = $props()
	const local = $derived(plane === 'local')
</script>

<span
	data-exec-badge
	data-plane={plane}
	class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-soft"
>
	<span class={local ? 'i-solar-cpu-bold-duotone h-3 w-3' : 'i-solar-server-minimalistic-bold-duotone h-3 w-3'}></span>
	{local ? 'on your device' : `via gateway · ${region}`}
</span>
