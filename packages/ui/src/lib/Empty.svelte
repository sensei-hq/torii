<script>
	// Consistent "nothing here yet" state — a muted Solar glyph + a line of text,
	// centered. Use inside a table via a colspan cell, or as a standalone block.
	//   <Empty icon="i-solar-inbox-line-duotone" message="No requests yet" />
	let {
		icon = 'i-solar-inbox-line-duotone',
		message = 'Nothing here yet',
		/** optional second line */
		hint = '',
		/** vertical padding size */
		pad = 'py-10'
	} = $props()
</script>

<div class="flex flex-col items-center justify-center gap-2 px-4 text-center {pad}">
	<span class="{icon} h-7 w-7 text-ink-faint" aria-hidden="true"></span>
	<span class="text-sm text-ink-mute">{message}</span>
	{#if hint}<span class="text-[11px] text-ink-faint">{hint}</span>{/if}
</div>
