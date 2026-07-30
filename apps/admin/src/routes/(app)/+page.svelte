<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Stat, Meter, Chip } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').RequestRow[]} */
	let requests = $state([])
	/** @type {import('$lib/api').BudgetNode[]} */
	let nodes = $state([])
	/** @type {import('$lib/api').AuditEvent[]} */
	let events = $state([])
	/** @type {import('$lib/api').Provider[]} */
	let providers = $state([])
	let error = $state('')
	let loading = $state(true)

	onMount(async () => {
		try {
			const [r, b, a, c] = await Promise.all([
				api.requests(200),
				api.budgets(),
				api.audit(8),
				api.connections()
			])
			requests = r.requests
			nodes = b.nodes
			events = a.events
			providers = c.providers
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	// derived aggregates — all computed from the real ledger, no mock data.
	const spend = $derived(requests.reduce((s, r) => s + Number(r.cost_usd || 0), 0))
	const tokens = $derived(
		requests.reduce((s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0)
	)
	const localShare = $derived(
		requests.length
			? Math.round(
					(requests.filter((r) => r.execution_location === 'local').length / requests.length) * 100
				)
			: 0
	)
	const connected = $derived(providers.filter((p) => p.configured).length)
	const orgRoot = $derived(nodes.find((n) => n.kind === 'org') ?? nodes[0])
	const budgetPct = $derived(
		orgRoot?.cap_amount ? Math.round((orgRoot.spent_amount / orgRoot.cap_amount) * 100) : 0
	)

	// top models by call volume, computed from the request ledger.
	const topModels = $derived(
		Object.entries(
			requests.reduce((/** @type {Record<string, number>} */ acc, r) => {
				acc[r.model] = (acc[r.model] ?? 0) + 1
				return acc
			}, {})
		)
			.map(([model, calls]) => ({ model, calls }))
			.sort((a, b) => b.calls - a.calls)
			.slice(0, 5)
	)

	/** @param {number} n */
	const money = (n) => '$' + n.toFixed(2)
	/** @param {string} iso */
	const fmtTime = (iso) =>
		new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<AppShell app="admin" title="Overview">
	<PageHeader
		eyebrow="Overview"
		title="Daily briefing"
		sub="The org's gateway at a glance — spend, traffic, budget headroom, and the most recent privileged changes."
	/>

	{#if loading}
		<p class="px-5 text-sm text-ink-mute">Loading…</p>
	{:else if error}
		<div class="px-5"><Card pad><p class="text-sm text-accent">{error}</p></Card></div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<!-- headline stats, all from the live ledger -->
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<Stat label="Requests" value={requests.length} hint="inference calls recorded" />
				<Stat
					label="Spend"
					value={money(spend)}
					hint={`${tokens.toLocaleString()} tokens metered`}
				/>
				<Stat
					label="On-device"
					value={`${localShare}%`}
					tone="accent"
					hint="ran on the local plane"
				/>
				<Stat
					label="Routers"
					value={connected}
					unit={`/ ${providers.length}`}
					hint="credentialed & reachable"
				/>
			</div>

			<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<!-- budget headroom on the org root -->
				<Card flush>
					<CardHead title="Budget headroom" meta={orgRoot ? orgRoot.name : ''} />
					<div class="p-4">
						{#if orgRoot}
							<Meter
								value={orgRoot.spent_amount}
								max={orgRoot.cap_amount ?? Math.max(orgRoot.spent_amount, 1)}
								tone={budgetPct >= 90 ? 'danger' : budgetPct >= 70 ? 'accent' : 'ink'}
								display={`${money(orgRoot.spent_amount)} / ${orgRoot.cap_amount == null ? '∞' : money(orgRoot.cap_amount)}`}
							/>
							<p class="mt-3 font-mono text-xs text-ink-mute">
								{budgetPct}% of the org cap used across {nodes.length} budget node{nodes.length ===
								1
									? ''
									: 's'} · {orgRoot.enforcement} enforcement
							</p>
						{:else}
							<p class="text-sm text-ink-mute">No budget nodes seeded.</p>
						{/if}
					</div>
				</Card>

				<!-- top models by call volume -->
				<Card flush>
					<CardHead title="Top models" meta="by call volume" />
					<div class="p-4">
						{#if topModels.length}
							<div class="space-y-2.5">
								{#each topModels as m (m.model)}
									<div class="flex items-center gap-3">
										<span class="w-40 truncate text-sm text-ink">{m.model}</span>
										<div class="flex-1">
											<Meter value={m.calls} max={topModels[0].calls} tone="ink" />
										</div>
										<span class="w-10 text-right font-mono text-xs text-ink-mute">{m.calls}</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-ink-mute">No requests yet.</p>
						{/if}
					</div>
				</Card>
			</div>

			<!-- recent privileged changes from the immutable audit ledger -->
			<Card flush>
				<CardHead title="Recent activity" meta={`${events.length}`} />
				<div>
					{#each events as e (e.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-2.5 last:border-b-0"
						>
							<span class="w-12 font-mono text-xs text-ink-mute">{fmtTime(e.created_at)}</span>
							<Chip>{e.action}</Chip>
							<span class="flex-1 truncate text-sm text-ink-soft">{e.target_type ?? '—'}</span>
							<span class="font-mono text-xs text-ink-mute"
								>{e.actor_id ? e.actor_id.slice(0, 8) : 'system'}</span
							>
						</div>
					{/each}
					{#if events.length === 0}
						<p class="px-4 py-3 text-sm text-ink-mute">No audit events yet.</p>
					{/if}
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
