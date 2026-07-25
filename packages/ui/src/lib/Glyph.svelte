<script>
	// Zen-Sumi glyph: a small square icon badge (sunken paper-mute + hairline).
	let { icon = '', size = 32, tone = 'mute' } = $props()
	const toneCls = $derived(
		tone === 'accent' ? 'text-accent' : tone === 'soft' ? 'text-ink-soft' : 'text-ink-mute'
	)
</script>

<span
	class="inline-flex flex-shrink-0 items-center justify-center rounded-md border border-paper-edge bg-paper-mute {toneCls}"
	style="width:{size}px;height:{size}px"
>
	{#if icon}<span class="{icon} h-1/2 w-1/2"></span>{/if}
</span>
