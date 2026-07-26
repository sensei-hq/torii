<script>
	import { onMount } from 'svelte'
	import { gateway } from '$lib/gateway.js'
	import { ExecBadge, Pill, Async } from '@torii/ui'

	let models = $state([])
	let loading = $state(true)
	let error = $state(null)

	const DEFAULT = 'gemma2:2b'

	onMount(async () => {
		try {
			models = await gateway.listModels()
		} catch {
			error = 'Local models are available in the desktop app.'
		} finally {
			loading = false
		}
	})
</script>

<section data-models class="flex h-full flex-col">
	<header class="border-b border-paper-edge px-6 py-4">
		<p class="text-xs uppercase tracking-wide text-ink-mute">Local</p>
		<h1 class="text-lg font-medium text-ink">Local models</h1>
		<p class="mt-0.5 text-sm text-ink-soft">Models available on this device — offline, $0.</p>
	</header>

	<div class="flex-1 overflow-auto px-6 py-4">
		{#if loading}
			<Async loading />
		{:else if error}
			<p class="text-sm text-ink-mute">{error}</p>
		{:else if models.length === 0}
			<p class="text-sm text-ink-mute">No local models found.</p>
		{:else}
			<ul class="divide-y divide-paper-edge">
				{#each models as m (m.id)}
					<li class="flex items-center gap-3 py-2.5">
						<span class="flex-1 text-sm text-ink">{m.name}</span>
						<ExecBadge plane="local" />
						{#if m.id === DEFAULT}
							<Pill label="default" tone="success" />
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<p class="mt-4 text-xs text-ink-mute">Default chat model: {DEFAULT}</p>
	</div>
</section>
