<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Meter, Chip } from '@strategos/ui'
	import { api } from '$lib/api'

	let nodes = $state([])
	let requests = $state([])
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')

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
	}
	onMount(load)

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
		eyebrow="Governance"
		title="Budgets & billing"
		sub="Cascading spend caps across the org → team → user tree, with pending increase requests."
	/>

	{#if loading}
		<p class="px-5 text-sm text-ink-mute">Loading…</p>
	{:else if error}
		<div class="px-5">
			<Card pad><p class="text-sm text-ink-soft">{error}</p></Card>
		</div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
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
								<Meter
									value={n.spent_amount}
									max={meterMax(n)}
									tone={meterTone(n)}
									display={`${money(n.spent_amount)} / ${money(n.cap_amount)}`}
								/>
							</div>
							<span
								class="w-12 text-right text-[11px] {n.enforcement === 'hard'
									? 'text-ink-soft'
									: 'text-ink-mute'}">{n.enforcement}</span
							>
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
								class="rounded-md bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-40"
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
		</div>
	{/if}
</AppShell>
