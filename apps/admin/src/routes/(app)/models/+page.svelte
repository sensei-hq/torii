<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import { providerList, filterModels, catalogSummary, tokenLabel } from '$lib/models'

	/** @type {import('$lib/api').ModelRow[]} */
	let models = $state([])
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')
	let provider = $state('all')

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

	/** Enable/disable a model for the tenant — a real, C1-enforced write. @param {import('$lib/api').ModelRow} m */
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

	const providers = $derived(providerList(models))
	const rows = $derived(filterModels(models, provider))
	const summary = $derived(catalogSummary(models))
</script>

<AppShell app="admin" title="Models">
	<PageHeader
		eyebrow="Models"
		title="Model catalog"
		sub="Every model your org can reach through the gateway — its context window, output ceiling, endpoint reachability, and whether it’s enabled for the tenant."
	/>

	{#if loading}
		<Async loading />
	{:else if error}
		<div class="px-4 sm:px-6 xl:px-12">
			<Card pad>
				<p class="text-sm text-danger">
					{error}{error.includes('403')
						? ' — needs the model.manage capability (owner/admin).'
						: ''}
				</p>
			</Card>
		</div>
	{:else}
		<div class="px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			<!-- provider filter (real). The mock's tier tabs need per-tenant tier metadata that
			     ModelRow doesn't carry — deferred to the catalog-metadata backend, not faked. -->
			<div class="mb-6 flex flex-wrap items-center gap-2">
				{#each ['all', ...providers] as p (p)}
					<button
						type="button"
						onclick={() => (provider = p)}
						class="rounded-full border px-3 py-1 text-xs transition-colors {provider === p
							? 'border-ink bg-ink text-on-primary'
							: 'border-paper-edge bg-paper text-ink-soft hover:bg-paper-mute'}"
						>{p === 'all' ? 'All providers' : p}</button
					>
				{/each}
			</div>

			<Card flush>
				<div class="overflow-auto">
					<table class="w-full text-xs">
						<thead
							class="font-mono text-xs uppercase tracking-wider text-ink-mute [&_th]:px-6 [&_th]:py-3 [&_th]:text-left [&_th]:font-medium"
						>
							<tr class="border-b border-paper-edge">
								<th>Model</th>
								<th>Route</th>
								<th class="!text-right">Context</th>
								<th class="!text-right">Max output</th>
								<th>Status</th>
								<th class="!text-right">Access</th>
							</tr>
						</thead>
						<tbody class="[&_td]:px-6 [&_td]:py-3">
							{#each rows as m (m.full_name)}
								<tr
									class="border-b border-paper-edge last:border-b-0 hover:bg-paper-mute/40"
									class:opacity-50={!m.enabled}
								>
									<td>
										<span class="flex items-center gap-2">
											<span class="h-2 w-2 shrink-0 rounded-full bg-ink-mute"></span>
											<span class="font-mono text-sm font-semibold text-ink"
												>{m.display_name ?? m.full_name}</span
											>
										</span>
										<div class="ml-4 mt-0.5 font-mono text-xs text-ink-mute">{m.provider}</div>
									</td>
									<td class="font-mono text-ink-soft">{m.full_name}</td>
									<td class="text-right font-mono text-ink-soft">{tokenLabel(m.context_window)}</td>
									<td class="text-right font-mono text-ink-soft"
										>{tokenLabel(m.max_output_tokens)}</td
									>
									<td>
										<Chip tone={m.reachable ? 'success' : 'mute'}>
											{m.reachable ? 'reachable' : 'no endpoint'}
										</Chip>
									</td>
									<td class="text-right">
										<button
											onclick={() => toggle(m)}
											disabled={busy === m.full_name}
											class="w-20 rounded-md border border-paper-edge px-2 py-1 text-xs font-medium text-ink-soft hover:bg-paper-mute disabled:opacity-40"
											>{m.enabled ? 'Disable' : 'Enable'}</button
										>
									</td>
								</tr>
							{/each}
							{#if rows.length === 0}
								<tr
									><td colspan="6">
										<Empty
											icon="i-solar-cpu-bold-duotone"
											message={models.length === 0 ? 'No models in the catalog' : 'No models match'}
											pad="py-8"
										/>
									</td></tr
								>
							{/if}
						</tbody>
					</table>
				</div>
				<div
					class="flex flex-wrap items-center gap-6 border-t border-dashed border-paper-edge px-6 py-3 font-mono text-xs text-ink-mute"
				>
					<span>{rows.length} of {summary.total} models · {summary.enabled} enabled</span>
					<span>reachable · <b class="text-success">{summary.reachable}</b></span>
					<span>providers · <b class="text-ink">{summary.providers}</b></span>
					<span class="ml-auto"
						>pricing, quality &amp; latency are per-tenant catalog metadata — coming with the model
						registry</span
					>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
