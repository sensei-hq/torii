<script>
	// Zen-Sumi chip: a small rounded label. `tone` = 'mute' (default), 'accent'
	// (vermillion), 'success', 'warning', or 'danger'.
	let { tone = 'mute', class: cls = '', children } = $props()
	const toneCls = $derived(
		tone === 'accent'
			? 'bg-accent-soft text-accent'
			: tone === 'success'
				? 'bg-success-soft text-success'
				: tone === 'warning'
					? 'bg-warning-soft text-warning'
					: tone === 'danger'
						? 'bg-danger-soft text-danger'
						: 'bg-paper-mute text-ink-mute'
	)
</script>

<span
	class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium {toneCls} {cls}"
	>{@render children?.()}</span
>
