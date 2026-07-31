<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip, Async } from '@torii/ui'
	import { resolve } from '$app/paths'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').RoutingStep[]} */
	let steps = $state([])
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')

	async function load() {
		try {
			steps = (await api.routing()).steps
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	/** @param {import('$lib/api').RoutingStep} s */
	async function toggle(s) {
		if (busy) return
		busy = s.id
		error = ''
		try {
			await api.setRoutingStep(s.id, !s.is_active)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	// group steps into ordered chains
	const chains = $derived(
		Object.entries(
			steps.reduce((/** @type {Record<string, import('$lib/api').RoutingStep[]>} */ acc, s) => {
				;(acc[s.chain_name] ??= []).push(s)
				return acc
			}, {})
		)
			.map(([name, rows]) => ({
				name,
				rows: rows.sort((a, b) => a.sequence_order - b.sequence_order)
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	)
	/** @param {string} p */
	const planeTone = (p) => (p === 'local' ? 'success' : 'mute')
</script>

<AppShell app="admin" title="Routing">
	<PageHeader
		eyebrow="Routing"
		title="Spend it like it’s yours"
		sub="Named fallback chains — the ordered router → model sequence the gateway steps through on budget pressure or provider error. Spend limits live in Organization; this is how the gateway behaves against them."
	>
		{#snippet actions()}
			<a
				href={resolve('/organization')}
				class="inline-flex items-center gap-1.5 rounded-full border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-mute"
			>
				<span class="i-solar-buildings-2-bold-duotone h-3.5 w-3.5 text-ink-mute"></span>
				budget limits → Organization
			</a>
		{/snippet}
	</PageHeader>

	{#if loading}
		<Async loading />
	{:else if error}
		<div class="px-4 sm:px-6 xl:px-12">
			<Card pad
				><p class="text-sm text-danger">
					{error}{error.includes('403') ? ' — needs the chain.read capability.' : ''}
				</p></Card
			>
		</div>
	{:else}
		<div class="space-y-6 px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			{#each chains as chain (chain.name)}
				<Card flush>
					<CardHead
						title={chain.name}
						meta={`${chain.rows.length} step${chain.rows.length === 1 ? '' : 's'}`}
					/>
					<div>
						{#each chain.rows as s (s.id)}
							<div
								class="flex items-center gap-3 border-b border-paper-edge px-6 py-2.5 last:border-b-0"
								class:opacity-50={!s.is_active}
							>
								<span
									class="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-paper-mute font-mono text-xs text-ink-mute"
									>{s.sequence_order}</span
								>
								<span class="h-2 w-2 shrink-0 rounded-full bg-ink-mute"></span>
								<span class="font-mono text-sm text-ink-soft">{s.router}</span>
								<span class="i-solar-alt-arrow-right-bold-duotone h-3.5 w-3.5 text-ink-faint"
								></span>
								<span class="flex-1 font-mono text-sm text-ink">{s.model}</span>
								<Chip tone={planeTone(s.plane)}>{s.plane}</Chip>
								<button
									onclick={() => toggle(s)}
									disabled={busy === s.id}
									class="w-20 rounded-md border border-paper-edge px-2 py-1 text-xs font-medium text-ink-soft hover:bg-paper-mute disabled:opacity-40"
									>{s.is_active ? 'Disable' : 'Enable'}</button
								>
							</div>
						{/each}
					</div>
				</Card>
			{/each}
			{#if chains.length === 0}
				<Card pad><p class="text-sm text-ink-mute">No fallback chains configured.</p></Card>
			{/if}
		</div>
	{/if}
</AppShell>
