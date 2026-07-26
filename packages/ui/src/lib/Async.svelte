<script>
	// Consistent loading / error / loaded states for a data-backed screen body. Usage:
	//   <Async {loading} {error}>{#snippet children()}…content…{/snippet}</Async>
	// Shows a skeleton while loading (announced via aria-busy/aria-live), a role="alert"
	// card on error, and the children once loaded. Pass `errorContent`/`loadingContent`
	// snippets to override. Local CSS (no dependency on animate-pulse / sr-only utilities).
	import Card from './Card.svelte'

	let {
		loading = false,
		error = '',
		/** number of skeleton bars while loading */
		rows = 3,
		children,
		loadingContent,
		errorContent
	} = $props()

	const widths = ['72%', '92%', '54%', '84%', '46%', '68%']
</script>

{#if loading}
	{#if loadingContent}
		{@render loadingContent()}
	{:else}
		<div class="space-y-3 px-5 py-6" aria-busy="true" aria-live="polite">
			<span class="async-sr">Loading…</span>
			{#each Array(rows) as _, i (i)}
				<div class="async-skel h-4 rounded bg-paper-mute" style="width:{widths[i % widths.length]}">
				</div>
			{/each}
		</div>
	{/if}
{:else if error}
	{#if errorContent}
		{@render errorContent(error)}
	{:else}
		<div class="px-5">
			<Card pad><p class="text-sm text-danger" role="alert">{error}</p></Card>
		</div>
	{/if}
{:else}
	{@render children?.()}
{/if}

<style>
	.async-skel {
		animation: async-pulse 1.4s ease-in-out infinite;
	}
	@keyframes async-pulse {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.async-skel {
			animation: none;
		}
	}
	.async-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
