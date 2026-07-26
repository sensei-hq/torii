<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip, Async } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').ModelRow[]} */
	let models = $state([])
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')

	async function load() {
		try {
			models = (await api.models()).models
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	/** @param {import('$lib/api').ModelRow} m */
	async function toggle(m) {
		if (busy) return
		busy = m.full_name
		error = ''
		try {
			await api.setModelEnabled(m.full_name, !m.enabled)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	// group by provider for the catalog display
	const byProvider = $derived(
		Object.entries(
			models.reduce((/** @type {Record<string, import('$lib/api').ModelRow[]>} */ acc, m) => {
				;(acc[m.provider] ??= []).push(m)
				return acc
			}, {})
		).sort((a, b) => a[0].localeCompare(b[0]))
	)
	const reachableCount = $derived(models.filter((m) => m.reachable).length)

	/** @param {number | null} n */
	const ctx = (n) => (n == null ? '—' : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))
</script>

<AppShell app="admin" title="Models">
	<PageHeader
		eyebrow="Gateway"
		title="Model catalog"
		sub="Every model the gateway can route to, by provider — context window, output ceiling, and whether an endpoint is reachable."
	/>

	{#if loading}
		<Async loading />
	{:else if error}
		<div class="px-5">
			<Card pad
				><p class="text-sm text-danger">
					{error}{error.includes('403') ? ' — needs the model.manage capability (owner/admin).' : ''}
				</p></Card
			>
		</div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<div class="grid grid-cols-3 gap-4">
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Models</div>
					<div class="font-heading text-2xl font-light text-ink">{models.length}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Reachable</div>
					<div class="font-heading text-2xl font-light text-ink">{reachableCount}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Providers</div>
					<div class="font-heading text-2xl font-light text-ink">{byProvider.length}</div>
				</Card>
			</div>

			{#each byProvider as [provider, rows] (provider)}
				<Card flush>
					<CardHead title={provider} meta={`${rows.length} model${rows.length === 1 ? '' : 's'}`} />
					<div class="overflow-auto">
						<table class="w-full text-xs">
							<thead
								class="text-[11px] uppercase tracking-wider text-ink-mute [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium"
							>
								<tr class="border-b border-paper-edge">
									<th>Model</th>
									<th>Full name</th>
									<th class="!text-right">Context</th>
									<th class="!text-right">Max output</th>
									<th>Status</th>
									<th class="!text-right">Access</th>
								</tr>
							</thead>
							<tbody class="[&_td]:px-4 [&_td]:py-2">
								{#each rows as m (m.full_name)}
									<tr
										class="border-b border-paper-edge last:border-b-0 hover:bg-paper-mute/40"
										class:opacity-40={!m.enabled}
									>
										<td class="text-ink">{m.display_name ?? m.full_name}</td>
										<td class="font-mono text-ink-mute">{m.full_name}</td>
										<td class="text-right font-mono text-ink-soft">{ctx(m.context_window)}</td>
										<td class="text-right font-mono text-ink-soft">{ctx(m.max_output_tokens)}</td>
										<td>
											<Chip tone={m.reachable ? 'success' : 'mute'}>
												{m.reachable ? 'reachable' : 'no endpoint'}
											</Chip>
										</td>
										<td class="text-right">
											<button
												onclick={() => toggle(m)}
												disabled={busy === m.full_name}
												class="w-20 rounded-md border border-paper-edge px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-paper-mute disabled:opacity-40"
												>{m.enabled ? 'Disable' : 'Enable'}</button
											>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</Card>
			{/each}
			{#if models.length === 0}
				<Card pad><p class="text-sm text-ink-mute">No models in the catalog.</p></Card>
			{/if}
		</div>
	{/if}
</AppShell>
