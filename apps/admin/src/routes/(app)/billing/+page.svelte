<script>
	import { onMount } from 'svelte'
	import { AppShell } from '@strategos/ui'
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
	/** @param {import('$lib/api').BudgetNode} node */
	const pct = (node) =>
		node.cap_amount ? Math.min(100, (node.spent_amount / node.cap_amount) * 100) : 0
	/** @type {Record<string, string>} */
	const indent = { org: '', dept: 'pl-4', team: 'pl-4', user: 'pl-8', service: 'pl-8' }
</script>

<AppShell app="admin" title="Budgets & Billing">
	{#if loading}
		<p class="p-4 text-ink-mute">Loading…</p>
	{:else if error}
		<div class="m-4 rounded border border-paper-edge bg-paper-soft p-3 text-sm text-ink-soft">
			{error}
		</div>
	{:else}
		<section class="p-4">
			<h2 class="mb-2 text-sm font-medium text-ink">Budget tree ({nodes.length})</h2>
			<div class="rounded border border-paper-edge">
				{#each nodes as n (n.id)}
					<div
						class="flex items-center gap-3 border-b border-paper-edge px-3 py-2 last:border-b-0 {indent[
							n.kind
						] ?? ''}"
					>
						<span class="w-40 truncate text-sm text-ink">{n.name}</span>
						<span class="rounded bg-paper-mute px-1.5 py-0.5 text-xs text-ink-mute">{n.kind}</span>
						<div class="flex-1">
							<div class="h-1.5 overflow-hidden rounded bg-paper-mute">
								<div class="h-full bg-primary-500" style="width:{pct(n)}%"></div>
							</div>
						</div>
						<span class="w-44 text-right text-xs text-ink-soft"
							>spent {money(n.spent_amount)} / cap {money(n.cap_amount)}</span
						>
						<span
							class="w-12 text-right text-xs {n.enforcement === 'hard'
								? 'text-ink-soft'
								: 'text-ink-mute'}">{n.enforcement}</span
						>
					</div>
				{/each}
			</div>
		</section>

		<section class="p-4">
			<h2 class="mb-2 text-sm font-medium text-ink">
				Pending increase requests ({requests.length})
			</h2>
			{#if requests.length === 0}
				<p class="text-sm text-ink-mute">No pending requests.</p>
			{:else}
				<div class="rounded border border-paper-edge">
					{#each requests as r (r.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-3 py-2 last:border-b-0"
						>
							<span class="flex-1 text-sm text-ink"
								>Requested cap {money(r.requested_cap)}
								<span class="text-ink-mute">— {r.reason ?? '(no reason)'}</span></span
							>
							<button
								onclick={() => resolve(r.id, 'approve')}
								disabled={busy === r.id}
								class="rounded bg-primary-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
								>Approve</button
							>
							<button
								onclick={() => resolve(r.id, 'deny')}
								disabled={busy === r.id}
								class="rounded border border-paper-edge px-3 py-1 text-xs text-ink-soft disabled:opacity-40"
								>Deny</button
							>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</AppShell>
