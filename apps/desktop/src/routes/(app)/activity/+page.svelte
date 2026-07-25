<script>
	import { onMount } from 'svelte'
	import { PageHeader, Card, CardHead, Chip } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').RequestRow[]} */
	let requests = $state([])
	let error = $state('')
	let loading = $state(true)

	onMount(async () => {
		try {
			requests = (await api.requests(100)).requests
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	const spend = $derived(requests.reduce((s, r) => s + Number(r.cost_usd || 0), 0))
	const localCount = $derived(requests.filter((r) => r.execution_location === 'local').length)

	/** @param {string} s */
	const fmtTime = (s) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
	/** @param {number} c */
	const fmtCost = (c) => (c === 0 ? '$0' : '$' + Number(c).toFixed(4))
	/** @param {string | null} p */
	const planeTone = (p) => (p === 'local' ? 'success' : 'mute')
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="You"
		title="Activity"
		sub="Every request you've run — where it ran, which model answered, and what it cost."
	/>

	{#if loading}
		<p class="px-5 text-sm text-ink-mute">Loading…</p>
	{:else if error}
		<div class="px-5">
			<Card pad
				><p class="text-sm text-ink-soft">
					{error}{error.includes('403') ? ' — activity needs the audit.read capability.' : ''}
				</p></Card
			>
		</div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<div class="grid grid-cols-3 gap-4">
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Requests</div>
					<div class="font-heading text-2xl font-light text-ink">{requests.length}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">On-device</div>
					<div class="font-heading text-2xl font-light text-ink">{localCount}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Spend</div>
					<div class="font-heading text-2xl font-light text-ink">{fmtCost(spend)}</div>
				</Card>
			</div>

			<Card flush>
				<CardHead title="Recent requests" meta={`${requests.length}`} />
				<div class="overflow-auto">
					<table class="w-full text-xs">
						<thead
							class="text-[11px] uppercase tracking-wider text-ink-mute [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium"
						>
							<tr class="border-b border-paper-edge">
								<th>When</th>
								<th>Model</th>
								<th>Where</th>
								<th class="!text-right">Tokens</th>
								<th class="!text-right">Cost</th>
							</tr>
						</thead>
						<tbody class="[&_td]:px-4 [&_td]:py-2">
							{#each requests as r (r.id)}
								<tr class="border-b border-paper-edge last:border-b-0 hover:bg-paper-mute/40">
									<td class="font-mono text-ink-mute">{fmtTime(r.recorded_at)}</td>
									<td class="text-ink">{r.model}</td>
									<td><Chip tone={planeTone(r.execution_location)}>{r.execution_location ?? '—'}</Chip></td>
									<td class="text-right font-mono text-ink-soft"
										>{r.input_tokens ?? 0}/{r.output_tokens ?? 0}</td
									>
									<td class="text-right font-mono text-ink-soft">{fmtCost(r.cost_usd)}</td>
								</tr>
							{/each}
							{#if requests.length === 0}
								<tr><td colspan="5" class="py-3 text-center text-ink-mute">No requests yet — ask something.</td></tr>
							{/if}
						</tbody>
					</table>
				</div>
			</Card>
		</div>
	{/if}
</section>
