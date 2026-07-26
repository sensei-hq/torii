<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip } from '@torii/ui'
	import { api } from '$lib/api'
	import { matchesRequest, matchesEvent } from '$lib/filters'

	/** @type {import('$lib/api').RequestRow[]} */
	let requests = $state([])
	/** @type {import('$lib/api').AuditEvent[]} */
	let events = $state([])
	let error = $state('')
	let loading = $state(true)

	// Client-side filters over the fetched page — the ledger is a bounded window (200 rows),
	// so searching is instant and needs no re-fetch. `plane` narrows requests only.
	let q = $state('')
	let plane = $state('all') // all | cloud | local

	onMount(async () => {
		try {
			const [r, a] = await Promise.all([api.requests(200), api.audit(200)])
			requests = r.requests
			events = a.events
		} catch (e) {
			error = String(e)
		} finally {
			loading = false
		}
	})

	const needle = $derived(q.trim().toLowerCase())
	const filteredRequests = $derived(requests.filter((r) => matchesRequest(r, needle, plane)))
	const filteredEvents = $derived(events.filter((e) => matchesEvent(e, needle)))

	/** @param {string} s */
	const fmtTime = (s) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	/** @param {number} c */
	const fmtCost = (c) => '$' + Number(c).toFixed(4)
	/** @param {string | null} p */
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
			<!-- filter bar: a single search narrows both tables; plane narrows requests -->
			<div class="relative">
				<span
					class="i-solar-magnifer-linear pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
				></span>
				<input
					bind:value={q}
					aria-label="Filter requests and audit events"
					placeholder="Filter by model, status, action, actor…"
					class="w-full rounded-md border border-paper-edge bg-paper py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
				/>
			</div>

			<Card flush>
				<CardHead title="Requests">
					{#snippet right()}
						<div class="flex items-center gap-3">
							<div
								class="inline-flex items-center gap-0.5 rounded-full border border-paper-edge p-0.5 text-[11px]"
							>
								{#each ['all', 'cloud', 'local'] as p (p)}
									<button
										onclick={() => (plane = p)}
										class="rounded-full px-2 py-0.5 {plane === p
											? 'bg-paper-mute font-medium text-accent'
											: 'text-ink-mute'}">{p}</button
									>
								{/each}
							</div>
							<span class="font-mono text-[11px] text-ink-mute"
								>{filteredRequests.length}/{requests.length}</span
							>
						</div>
					{/snippet}
				</CardHead>
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
							{#each filteredRequests as r (r.id)}
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
							{#if filteredRequests.length === 0}
								<tr
									><td colspan="7" class="py-3 text-center text-ink-mute"
										>{requests.length === 0 ? 'No requests yet.' : 'No requests match.'}</td
									></tr
								>
							{/if}
						</tbody>
					</table>
				</div>
			</Card>

			<Card flush>
				<CardHead title="Audit ledger" meta={`${filteredEvents.length}/${events.length}`} />
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
							{#each filteredEvents as e (e.id)}
								<tr class="border-b border-paper-edge last:border-b-0 hover:bg-paper-mute/40">
									<td class="font-mono text-ink-mute">{fmtTime(e.created_at)}</td>
									<td class="text-ink">{e.action}</td>
									<td class="text-ink-soft">{e.target_type ?? '—'}</td>
									<td class="font-mono text-ink-soft"
										>{e.actor_id ? e.actor_id.slice(0, 8) : 'system'}</td
									>
								</tr>
							{/each}
							{#if filteredEvents.length === 0}
								<tr
									><td colspan="4" class="py-3 text-center text-ink-mute"
										>{events.length === 0 ? 'No audit events yet.' : 'No events match.'}</td
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
