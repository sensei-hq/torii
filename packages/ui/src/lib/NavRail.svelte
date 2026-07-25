<script>
	let { items = [], active, appName = 'Torii', version = 0, onnavigate, footer } = $props()
</script>

<nav
	aria-label="Primary"
	data-nav-rail
	class="flex flex-col border-r border-paper-edge bg-paper-soft"
>
	<!-- Brand + version -->
	<div class="flex items-center gap-2 px-3 py-3">
		<span class="text-sm font-semibold text-accent">{appName}</span>
		<span class="text-xs text-ink-mute">v{version}</span>
	</div>

	<!-- Nav items -->
	<div class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
		{#each items as item (item)}
			<button
				type="button"
				onclick={() => onnavigate?.(item)}
				aria-current={item === active ? 'page' : undefined}
				class="rounded px-2 py-1.5 text-left text-sm {item === active
					? 'bg-paper-soft text-accent'
					: 'text-ink-soft hover:bg-paper-mute'}"
			>
				{item}
			</button>
		{/each}
	</div>

	<!-- Footer snippet pinned at bottom -->
	{#if footer}
		{@render footer()}
	{/if}
</nav>
