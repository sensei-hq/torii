<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip } from '@torii/ui'
	import { api } from '$lib/api'

	let requests = $state([])
	let events = $state([])
	let error = $state('')
	let loading = $state(true)

	onMount(async () => {
		try {
			const [r, a] = await Promise.all([api.requests(50), api.audit(50)])
			requests = r.requests
			events = a.events
		} catch (e) {
			error = String(e)
		} finally {
			loading = false
		}
	})

	/** @param {string} s */
	const fmtTime = (s) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	/** @param {number} c */
	const fmtCost = (c) => '$' + Number(c).toFixed(4)
	/** @param {string} p */
	const planeTone = (p) => (p === 'local' ? 'success' : 'mute')
</script>

<AppShell app="admin" title="Requests & audit">
	<PageHeader
		eyebrow="Observability"
		title="Requests & audit"
		sub="Every inference call and every privileged change, from the immutable ledger."
	/>

	{#if loading}
		<p class="px-5 text-sm text-ink-mute">Loading…</p>
	{:else if error}
		<div class="px-5">
			<Card pad
				><p class="text-sm text-ink-soft">
					{error} — sign in (the gateway requires a session JWT).
				</p></Card
			>
		</div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<Card flush>
				<CardHead title="Requests" meta={`${requests.length}`} />
				<div class="overflow-auto">
					<table class="w-full text-xs">
						<thead
							class="text-[11px] uppercase tracking-wider text-ink-mute [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium"
						>
							<tr class="border-b border-paper-edge">
								<th>Time</th>
								<th>Model</th>
								<th>Chain</th>
								<th>Plane</th>
								<th class="!text-right">Tokens</th>
								<th class="!text-right">Cost</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody class="[&_td]:px-4 [&_td]:py-2">
							{#each requests as r (r.id)}
								<tr class="border-b border-paper-edge last:border-b-0 hover:bg-paper-mute/40">
									<td class="font-mono text-ink-mute">{fmtTime(r.recorded_at)}</td>
									<td class="text-ink">{r.model}</td>
									<td class="text-ink-soft">{r.chain_id ?? '—'}</td>
									<td
										><Chip tone={planeTone(r.execution_location)}
											>{r.execution_location ?? '—'}</Chip
										></td
									>
									<td class="text-right font-mono text-ink-soft"
										>{r.input_tokens ?? 0}/{r.output_tokens ?? 0}</td
									>
									<td class="text-right font-mono text-ink-soft">{fmtCost(r.cost_usd)}</td>
									<td class="text-ink-soft">{r.status}</td>
								</tr>
							{/each}
							{#if requests.length === 0}
								<tr><td colspan="7" class="py-3 text-center text-ink-mute">No requests yet.</td></tr
								>
							{/if}
						</tbody>
					</table>
				</div>
			</Card>

			<Card flush>
				<CardHead title="Audit ledger" meta={`${events.length}`} />
				<div class="overflow-auto">
					<table class="w-full text-xs">
						<thead
							class="text-[11px] uppercase tracking-wider text-ink-mute [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium"
						>
							<tr class="border-b border-paper-edge">
								<th>Time</th>
								<th>Action</th>
								<th>Target</th>
								<th>Actor</th>
							</tr>
						</thead>
						<tbody class="[&_td]:px-4 [&_td]:py-2">
							{#each events as e (e.id)}
								<tr class="border-b border-paper-edge last:border-b-0 hover:bg-paper-mute/40">
									<td class="font-mono text-ink-mute">{fmtTime(e.created_at)}</td>
									<td class="text-ink">{e.action}</td>
									<td class="text-ink-soft">{e.target_type ?? '—'}</td>
									<td class="font-mono text-ink-soft"
										>{e.actor_id ? e.actor_id.slice(0, 8) : 'system'}</td
									>
								</tr>
							{/each}
							{#if events.length === 0}
								<tr
									><td colspan="4" class="py-3 text-center text-ink-mute">No audit events yet.</td
									></tr
								>
							{/if}
						</tbody>
					</table>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
