<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Meter, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import { costBreakdown } from '$lib/billing'

	let nodes = $state([])
	let requests = $state([])
	/** @type {import('$lib/api').RequestRow[]} — the inference ledger, aggregated for the cost breakdown */
	let ledger = $state([])
	let error = $state('')
	let ledgerError = $state('')
	let loading = $state(true)
	let busy = $state('')
	let editing = $state('') // node id being edited
	let capDraft = $state('')

	async function load() {
		try {
			const b = await api.budgets()
			nodes = b.nodes
			requests = b.requests
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
		// The cost breakdown reads the inference ledger (/v1/requests) — a different capability
		// from budget.read. A denial (or a tenant with no traffic yet) must NOT blank the budget
		// governance above, so it loads independently into its own error slot.
		try {
			const r = await api.requests(200)
			ledger = r.requests
		} catch (e) {
			ledgerError = e instanceof Error ? e.message : String(e)
		}
	}
	onMount(load)

	// Provider/model spend aggregated from the real ledger, richest first.
	const breakdown = $derived(costBreakdown(ledger))

	/**
	 * @param {string} id
	 * @param {'approve' | 'deny'} action
	 */
	async function resolve(id, action) {
		busy = id
		error = ''
		try {
			if (action === 'approve') await api.approveBudgetRequest(id)
			else await api.denyBudgetRequest(id)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/** @param {import('$lib/api').BudgetNode} n */
	function startEdit(n) {
		editing = n.id
		capDraft = n.cap_amount == null ? '' : String(n.cap_amount)
		error = ''
	}
	/** @param {import('$lib/api').BudgetNode} n → save the node's cap via the upsert RPC */
	async function saveCap(n) {
		busy = n.id
		error = ''
		try {
			const raw = capDraft.trim()
			await api.upsertBudgetNode({
				id: n.id,
				kind: n.kind,
				name: n.name,
				cap_amount: raw === '' ? null : Number(raw),
				enforcement: n.enforcement,
				period: n.period
			})
			editing = ''
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/** @param {number | null} n */
	const money = (n) => (n == null ? '∞' : '$' + Number(n).toFixed(2))
	/** @param {import('$lib/api').BudgetNode} n */
	const meterMax = (n) => n.cap_amount ?? Math.max(n.spent_amount, 1)
	/** @param {import('$lib/api').BudgetNode} n */
	const meterTone = (n) => (n.cap_amount && n.spent_amount / n.cap_amount >= 0.9 ? 'accent' : 'ink')
	/** @type {Record<string, number>} */
	const depth = { org: 0, dept: 1, team: 1, user: 2, service: 2 }
</script>

<AppShell app="admin" title="Budgets & Billing">
	<PageHeader
		eyebrow="Billing"
		title="Budgets & billing"
		sub="One license, governed like thousands. Caps cascade from the org down to each member; spend is metered on every call through the gateway. Plans, seats and invoices arrive with launch billing."
	/>

	{#if loading}
		<Async loading />
	{:else if error}
		<div class="px-4 sm:px-6 xl:px-12">
			<Card pad><p class="text-sm text-ink-soft">{error}</p></Card>
		</div>
	{:else}
		<div class="space-y-6 px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			<Card flush>
				<CardHead title="Budget tree" meta={`${nodes.length} nodes`} />
				<div>
					{#each nodes as n (n.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge py-2.5 pr-4 last:border-b-0"
							style="padding-left:{16 + (depth[n.kind] ?? 0) * 22}px"
						>
							<span class="w-36 truncate text-sm text-ink">{n.name}</span>
							<Chip>{n.kind}</Chip>
							<div class="flex-1">
								{#if editing === n.id}
									<div class="flex items-center gap-2">
										<span class="text-xs text-ink-mute">cap $</span>
										<input
											bind:value={capDraft}
											aria-label="Budget cap amount"
											inputmode="decimal"
											placeholder="∞ (blank = no cap)"
											class="w-32 rounded-md border border-paper-edge bg-paper px-2 py-1 font-mono text-xs text-ink focus:border-ink focus:outline-none"
											onkeydown={(e) => e.key === 'Enter' && saveCap(n)}
										/>
										<button
											onclick={() => saveCap(n)}
											disabled={busy === n.id}
											class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-on-primary disabled:opacity-40"
											>Save</button
										>
										<button
											onclick={() => (editing = '')}
											class="rounded-md border border-paper-edge px-2.5 py-1 text-xs text-ink-soft hover:bg-paper-mute"
											>Cancel</button
										>
									</div>
								{:else}
									<Meter
										value={n.spent_amount}
										max={meterMax(n)}
										tone={meterTone(n)}
										display={`${money(n.spent_amount)} / ${money(n.cap_amount)}`}
									/>
								{/if}
							</div>
							<span
								class="w-12 text-right text-xs {n.enforcement === 'hard'
									? 'text-ink-soft'
									: 'text-ink-mute'}">{n.enforcement}</span
							>
							{#if editing !== n.id}
								<button
									onclick={() => startEdit(n)}
									aria-label="Edit cap"
									title="Edit cap"
									class="rounded-md p-1 text-ink-mute hover:bg-paper-mute hover:text-ink"
								>
									<span class="i-solar-pen-2-bold-duotone block h-3.5 w-3.5"></span>
								</button>
							{/if}
						</div>
					{/each}
				</div>
			</Card>

			<Card flush>
				<CardHead title="Pending increase requests" meta={`${requests.length}`} />
				{#if requests.length === 0}
					<p class="px-4 py-3 text-sm text-ink-mute">No pending requests.</p>
				{:else}
					{#each requests as r (r.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-2.5 last:border-b-0"
						>
							<span class="flex-1 text-sm text-ink"
								>Requested cap <span class="font-mono">{money(r.requested_cap)}</span>
								<span class="text-ink-mute">— {r.reason ?? '(no reason)'}</span></span
							>
							<button
								onclick={() => resolve(r.id, 'approve')}
								disabled={busy === r.id}
								class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-on-primary disabled:opacity-40"
								>Approve</button
							>
							<button
								onclick={() => resolve(r.id, 'deny')}
								disabled={busy === r.id}
								class="rounded-md border border-paper-edge px-3 py-1 text-xs text-ink-soft hover:bg-paper-mute disabled:opacity-40"
								>Deny</button
							>
						</div>
					{/each}
				{/if}
			</Card>

			<!-- Cost breakdown: real metered spend aggregated by provider (adapter) and model from
			     the inference ledger. This is the metering half of "billing" that IS built. -->
			<Card flush>
				<CardHead title="Cost breakdown" icon="i-solar-chart-2-bold-duotone">
					{#snippet right()}
						<span class="font-mono text-xs text-ink-mute">
							{money(breakdown.total)} metered · {breakdown.calls} call{breakdown.calls === 1
								? ''
								: 's'}
						</span>
					{/snippet}
				</CardHead>
				{#if ledgerError}
					<p class="px-4 py-4 text-sm text-ink-mute">Ledger unavailable — {ledgerError}</p>
				{:else if breakdown.calls === 0}
					<Empty
						icon="i-solar-chart-2-bold-duotone"
						message="No metered calls yet — provider and model spend will break down here as traffic flows through the gateway."
						pad="py-8"
					/>
				{:else}
					<div class="grid gap-0 md:grid-cols-2">
						<!-- by provider (the routing adapter) -->
						<div class="space-y-3 border-b border-paper-edge p-5 md:border-b-0 md:border-r">
							<p class="text-xs uppercase tracking-wider text-ink-mute">By provider</p>
							{#each breakdown.providers as p (p.provider)}
								<div class="flex items-center gap-3">
									<span class="h-2 w-2 shrink-0 rounded-full bg-ink-mute"></span>
									<span class="w-28 truncate text-sm capitalize text-ink" title={p.provider}
										>{p.provider}</span
									>
									<div class="flex-1">
										<Meter
											value={p.cost}
											max={breakdown.total || 1}
											tone={p.pct >= 50 ? 'accent' : 'ink'}
										/>
									</div>
									<span
										class="w-24 text-right font-mono text-xs {p.cost === 0
											? 'text-success'
											: 'text-ink-mute'}">{p.cost === 0 ? 'free' : money(p.cost)} · {p.pct}%</span
									>
								</div>
							{/each}
						</div>

						<!-- by model -->
						<div class="space-y-3 p-5">
							<p class="text-xs uppercase tracking-wider text-ink-mute">By model</p>
							{#each breakdown.models as m (m.provider + ' ' + m.model)}
								<div class="flex items-center gap-3">
									<span class="h-2 w-2 shrink-0 rounded-full bg-ink-mute"></span>
									<span class="w-32 truncate font-mono text-sm text-ink" title={m.model}
										>{m.model}</span
									>
									<div class="flex-1">
										<Meter value={m.cost} max={breakdown.total || 1} />
									</div>
									<span
										class="w-16 text-right font-mono text-xs {m.cost === 0
											? 'text-success'
											: 'text-ink-mute'}">{m.cost === 0 ? 'free' : money(m.cost)}</span
									>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</Card>

			<!-- Commercial billing (plans / seats / invoices / payment) is v1.x — DECISIONS §10.1. -->
			<div
				class="flex items-start gap-2 rounded-lg border border-dashed border-paper-edge px-4 py-3"
			>
				<span class="i-solar-info-circle-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
				<span class="text-xs leading-relaxed text-ink-mute">
					This screen is spend governance — the budget tree and increase requests. Plans, seats and
					invoices arrive with launch billing.
				</span>
			</div>
		</div>
	{/if}
</AppShell>
