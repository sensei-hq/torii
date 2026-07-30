<script>
	// Zen-Sumi stat tile: an uppercase-tracked eyebrow, a large display number with an
	// optional unit, and an optional mono hint below. `tone` colours the number
	// ('ink' default, 'accent' = vermillion, 'danger').
	let { label = '', value = '', unit = '', hint = '', tone = 'ink', class: cls = '' } = $props()
	const numTone = $derived(
		tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : 'text-ink'
	)
</script>

<div class="rounded-lg border border-paper-edge bg-paper-soft p-6 {cls}">
	<div class="mb-2.5 text-xs font-medium uppercase tracking-[0.18em] text-ink-mute">{label}</div>
	<div class="flex items-baseline gap-1">
		<span class="font-heading text-3xl font-light leading-none {numTone}">{value}</span>
		{#if unit}<span class="text-sm text-ink-mute">{unit}</span>{/if}
	</div>
	{#if hint}<div class="mt-2 font-mono text-xs text-ink-mute">{hint}</div>{/if}
</div>
