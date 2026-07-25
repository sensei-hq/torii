<script>
	// Zen-Sumi card header: hairline-bottomed strip with an eyebrow (uppercase, tracked)
	// on the left and optional mono meta on the right. Pass `left`/`right` snippets to
	// override, or `title`(+`icon`) / `meta` for the common pattern.
	let { title = '', icon = '', meta = '', left, right } = $props()
</script>

<div class="flex items-center justify-between border-b border-paper-edge px-4 py-2.5">
	{#if left}
		{@render left()}
	{:else}
		<span class="flex items-center gap-2">
			{#if icon}<span class="{icon} h-3.5 w-3.5 text-ink-soft"></span>{/if}
			<span class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{title}</span>
		</span>
	{/if}
	{#if right}
		{@render right()}
	{:else if meta}
		<span class="font-mono text-[11px] text-ink-mute">{meta}</span>
	{/if}
</div>
