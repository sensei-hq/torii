<script>
	// Zen-Sumi page header: eyebrow (uppercase, tracked) + display-serif title + optional
	// sub, with an optional right-aligned `actions` snippet.
	let { eyebrow = '', title = '', sub = '', actions } = $props()
</script>

<div class="flex items-start justify-between gap-4 px-6 pb-3 pt-6 lg:px-12">
	<div class="min-w-0">
		{#if eyebrow}
			<div class="mb-0.5 text-xs font-medium uppercase tracking-widest text-ink-mute">
				{eyebrow}
			</div>
		{/if}
		<h1 class="font-heading text-2xl font-normal tracking-tight text-ink">{title}</h1>
		{#if sub}
			<p class="mt-1 max-w-xl text-sm text-ink-soft">{sub}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex flex-shrink-0 items-center gap-2">{@render actions()}</div>
	{/if}
</div>
