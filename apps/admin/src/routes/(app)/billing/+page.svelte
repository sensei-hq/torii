<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Meter, Chip, Async } from '@torii/ui'
	import { api } from '$lib/api'

	let nodes = $state([])
	let requests = $state([])
	let error = $state('')
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
		eyebrow="Governance"
		title="Budgets & billing"
		sub="Cascading spend caps across the org → team → user tree, with pending increase requests."
	/>

	{#if loading}
		<Async loading />
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
								{#if editing === n.id}
									<div class="flex items-center gap-2">
										<span class="text-[11px] text-ink-mute">cap $</span>
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
								class="w-12 text-right text-[11px] {n.enforcement === 'hard'
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
		</div>
	{/if}
</AppShell>
