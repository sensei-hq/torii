<script>
	// Zen-Sumi meter: a labelled progress bar. `tone` picks the fill — 'ink' (default),
	// 'accent' (vermillion, for at/over threshold) or 'danger'. `display` is the right-
	// aligned value text (usually mono), `hint` a faint sub-line.
	let { label = '', value = 0, max = 100, display = '', tone = 'ink', hint = '' } = $props()
	const pct = $derived(max ? Math.min(100, Math.max(0, (value / max) * 100)) : 0)
	const fill = $derived(
		tone === 'accent' ? 'bg-primary-500' : tone === 'danger' ? 'bg-red-500' : 'bg-ink'
	)
</script>

<div class="w-full">
	{#if label || display}
		<div class="mb-1 flex items-center justify-between gap-2 text-[11px]">
			<span class="truncate text-ink-mute">{label}</span>
			{#if display}<span class="font-mono text-ink-soft">{display}</span>{/if}
		</div>
	{/if}
	<div class="h-1.5 overflow-hidden rounded-full bg-paper-mute">
		<div class="h-full {fill}" style="width:{pct}%"></div>
	</div>
	{#if hint}<div class="mt-1 text-[11px] text-ink-faint">{hint}</div>{/if}
</div>
