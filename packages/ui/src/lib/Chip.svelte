<script>
	// Zen-Sumi chip: a small rounded label. `tone` = 'mute' (default), 'accent'
	// (vermillion), 'success', or 'warning'.
	let { tone = 'mute', class: cls = '', children } = $props()
	const toneCls = $derived(
		tone === 'accent'
			? 'bg-primary-500/12 text-primary-500'
			: tone === 'success'
				? 'bg-emerald-500/12 text-emerald-600'
				: tone === 'warning'
					? 'bg-amber-500/15 text-amber-600'
					: 'bg-paper-mute text-ink-mute'
	)
</script>

<span
	class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium {toneCls} {cls}"
	>{@render children?.()}</span
>
