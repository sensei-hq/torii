<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip, Meter, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import { matchesRequest, matchesEvent } from '$lib/filters'
	import {
		groupByStatus,
		triageSummary,
		cascadePath,
		leafNodes,
		nodePct,
		toCsv,
		csvFilename,
		money
	} from '$lib/requests'

	/** @type {import('$lib/api').RequestRow[]} */
	let requests = $state([])
	/** @type {import('$lib/api').AuditEvent[]} */
	let events = $state([])
	/** @type {import('$lib/api').BudgetNode[]} */
	let nodes = $state([])
	/** @type {import('$lib/api').BudgetRequest[]} */
	let pending = $state([])
	let error = $state('')
	let budgetError = $state('')
	let loading = $state(true)

	// Client-side filters over the fetched page — the ledger is a bounded window (200 rows),
	// so searching is instant and needs no re-fetch. `plane` narrows requests only.
	let q = $state('')
	let plane = $state('all') // all | cloud | local
	let statusFilter = $state('all') // set by clicking an exception-triage group

	async function loadBudgets() {
		// budget.read is a separate capability from audit.read — a denial (or a tenant with
		// no budget tree seeded) must NOT blank the ledger, so it loads independently.
		try {
			const b = await api.budgets()
			nodes = b.nodes
			pending = b.requests
			budgetError = ''
		} catch (e) {
			budgetError = e instanceof Error ? e.message : String(e)
		}
	}

	onMount(async () => {
		try {
			const [r, a] = await Promise.all([api.requests(200), api.audit(200)])
			requests = r.requests
			events = a.events
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
		await loadBudgets()
	})

	const needle = $derived(q.trim().toLowerCase())
	const groups = $derived(groupByStatus(requests))
	const triage = $derived(triageSummary(groups))
	const filteredRequests = $derived(
		requests
			.filter((r) => matchesRequest(r, needle, plane))
			.filter(
				(r) => statusFilter === 'all' || (r.status || 'unknown').toLowerCase() === statusFilter
			)
	)
	const filteredEvents = $derived(events.filter((e) => matchesEvent(e, needle)))

	// ── member budget cascade + request-increase ──────────────────────────────
	const leaves = $derived(leafNodes(nodes))
	let targetId = $state('')
	const selected = $derived(leaves.find((n) => n.id === targetId) ?? leaves[0])
	const cascade = $derived(selected ? cascadePath(nodes, selected.id) : [])

	// preset increment over the node's current cap (or spend, when uncapped).
	let delta = $state(250)
	let reason = $state('')
	let reqBusy = $state(false)
	let reqError = $state('')
	/** @type {{ node: string; cap: number } | null} */
	let reqSent = $state(null)
	const base = $derived(selected ? (selected.cap_amount ?? selected.spent_amount) : 0)
	const requestedCap = $derived(base + delta)

	async function sendRequest() {
		if (!selected) return
		reqBusy = true
		reqError = ''
		try {
			await api.requestBudgetIncrease(selected.id, requestedCap, reason.trim() || undefined)
			reqSent = { node: selected.name, cap: requestedCap }
			reason = ''
			await loadBudgets() // reflect the new pending row from the server, not a local guess
		} catch (e) {
			reqError = e instanceof Error ? e.message : String(e)
		} finally {
			reqBusy = false
		}
	}

	function exportCsv() {
		const blob = new Blob([toCsv(filteredRequests)], { type: 'text/csv;charset=utf-8' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = csvFilename()
		a.click()
		URL.revokeObjectURL(url)
	}

	/** @param {string} status */
	function toggleStatus(status) {
		statusFilter = statusFilter === status ? 'all' : status
	}

	/** @param {string} s */
	const fmtTime = (s) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	/** @param {number} c */
	const fmtCost = (c) => '$' + Number(c).toFixed(4)
	/** @param {string | null} p */
	const planeTone = (p) => (p === 'local' ? 'success' : 'mute')
	/** @param {string} kind */
	const nodeIcon = (kind) =>
		kind === 'org'
			? 'i-solar-buildings-2-bold-duotone'
			: kind === 'user'
				? 'i-solar-user-bold-duotone'
				: kind === 'service'
					? 'i-solar-cpu-bold-duotone'
					: 'i-solar-users-group-rounded-bold-duotone'
</script>

<AppShell app="admin" title="Requests & audit">
	<PageHeader
		eyebrow="Observability"
		title="Requests & audit"
		sub="Every inference call and every privileged change, from the immutable ledger."
	/>

	{#if loading}
		<Async loading />
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

			<!-- exception triage: group the ledger by outcome; exceptions lead. Click a group
			     to narrow the table below to just those calls. -->
			<Card flush>
				<CardHead title="Exception triage" icon="i-solar-danger-triangle-bold-duotone">
					{#snippet right()}
						{#if triage.total > 0}
							<span class="font-mono text-xs text-ink-mute">
								{triage.exceptions} exception{triage.exceptions === 1 ? '' : 's'} · {triage.exceptionPct}%
								· {money(triage.exceptionCost)}
							</span>
						{:else}
							<span class="font-mono text-xs text-ink-mute">no calls yet</span>
						{/if}
					{/snippet}
				</CardHead>
				{#if groups.length}
					<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
						{#each groups as g (g.status)}
							<button
								type="button"
								onclick={() => toggleStatus(g.status)}
								aria-pressed={statusFilter === g.status}
								class="flex flex-col gap-1.5 border-b border-r border-paper-edge p-4 text-left transition-colors hover:bg-paper-mute/40 {statusFilter ===
								g.status
									? 'bg-paper-mute'
									: ''}"
							>
								<div class="flex items-center gap-2">
									<span
										class="h-2 w-2 shrink-0 rounded-full {g.tone === 'success'
											? 'bg-success'
											: g.tone === 'danger'
												? 'bg-danger'
												: g.tone === 'warning'
													? 'bg-warning'
													: 'bg-ink-mute'}"
									></span>
									<span class="text-sm font-semibold text-ink">{g.label}</span>
									{#if g.isException}
										<Chip tone={g.tone}>exception</Chip>
									{/if}
								</div>
								<div class="flex items-baseline gap-1">
									<span class="font-heading text-2xl font-light leading-none text-ink"
										>{g.count}</span
									>
									<span class="font-mono text-xs text-ink-mute">· {g.pct}%</span>
								</div>
								<span class="font-mono text-xs text-ink-mute">{money(g.cost)} spent</span>
							</button>
						{/each}
					</div>
				{:else}
					<Empty
						icon="i-solar-clipboard-list-bold-duotone"
						message="No calls yet — outcomes will group here as traffic flows."
						pad="py-8"
					/>
				{/if}
			</Card>

			<Card flush>
				<CardHead title="Requests">
					{#snippet right()}
						<div class="flex items-center gap-3">
							{#if statusFilter !== 'all'}
								<button
									type="button"
									onclick={() => (statusFilter = 'all')}
									class="inline-flex items-center gap-1 rounded-full bg-paper-mute px-2 py-0.5 text-xs text-ink-soft hover:text-ink"
								>
									status: {statusFilter}
									<span class="i-solar-close-circle-bold-duotone h-3 w-3"></span>
								</button>
							{/if}
							<div
								class="inline-flex items-center gap-0.5 rounded-full border border-paper-edge p-0.5 text-xs"
							>
								{#each ['all', 'cloud', 'local'] as p (p)}
									<button
										type="button"
										onclick={() => (plane = p)}
										class="rounded-full px-2 py-0.5 {plane === p
											? 'bg-paper-mute font-medium text-accent'
											: 'text-ink-mute'}">{p}</button
									>
								{/each}
							</div>
							<button
								type="button"
								onclick={exportCsv}
								disabled={filteredRequests.length === 0}
								class="inline-flex items-center gap-1.5 rounded-md border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-mute disabled:cursor-not-allowed disabled:opacity-50"
							>
								<span class="i-solar-download-minimalistic-bold-duotone h-3.5 w-3.5"></span>
								Export CSV
							</button>
							<span class="font-mono text-xs text-ink-mute"
								>{filteredRequests.length}/{requests.length}</span
							>
						</div>
					{/snippet}
				</CardHead>
				<div class="overflow-auto">
					<table class="w-full text-xs">
						<thead
							class="text-xs uppercase tracking-wider text-ink-mute [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium"
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
									><td colspan="7"
										><Empty
											icon="i-solar-clipboard-list-bold-duotone"
											message={requests.length === 0 ? 'No requests yet' : 'No requests match'}
											pad="py-8"
										/></td
									></tr
								>
							{/if}
						</tbody>
					</table>
				</div>
			</Card>

			<!-- member budget cascade + request-increase -->
			<Card flush>
				<CardHead title="Member budget cascade" icon="i-solar-wallet-money-bold-duotone">
					{#snippet right()}
						{#if leaves.length}
							<label class="flex items-center gap-2 text-xs text-ink-mute">
								<span class="uppercase tracking-wider">Member</span>
								<select
									bind:value={targetId}
									class="rounded-sm border border-paper-edge bg-paper px-1.5 py-1 font-mono text-xs text-ink-soft"
								>
									{#each leaves as n (n.id)}
										<option value={n.id}>{n.name} · {nodePct(n)}%</option>
									{/each}
								</select>
							</label>
						{/if}
					{/snippet}
				</CardHead>
				{#if budgetError}
					<p class="px-4 py-4 text-sm text-ink-mute">
						Budget tree unavailable — {budgetError}
					</p>
				{:else if !nodes.length}
					<Empty
						icon="i-solar-wallet-bold-duotone"
						message="No budget nodes seeded for this tenant."
						pad="py-8"
					/>
				{:else if selected}
					<div class="grid gap-0 md:grid-cols-2">
						<!-- the chain of caps this member inherits from: org → dept → you -->
						<div class="space-y-4 border-b border-paper-edge p-5 md:border-b-0 md:border-r">
							<p class="text-xs uppercase tracking-wider text-ink-mute">
								The budget you cascade from
							</p>
							{#each cascade as n, i (n.id)}
								{@const last = i === cascade.length - 1}
								<div style="padding-left:{i * 16}px">
									<div class="mb-1 flex items-center gap-2">
										<span
											class="{nodeIcon(n.kind)} h-3.5 w-3.5 {last
												? 'text-accent'
												: 'text-ink-mute'}"
										></span>
										<span class="text-sm {last ? 'font-semibold text-ink' : 'text-ink-soft'}"
											>{n.name}</span
										>
										<span class="flex-1"></span>
										<span class="font-mono text-xs text-ink-mute"
											>{money(n.spent_amount)} / {n.cap_amount == null
												? '∞'
												: money(n.cap_amount)}</span
										>
									</div>
									<Meter
										value={n.spent_amount}
										max={n.cap_amount ?? Math.max(n.spent_amount, 1)}
										tone={last ? 'accent' : 'ink'}
									/>
								</div>
							{/each}
							<p class="font-mono text-xs text-ink-faint">
								{selected.name}'s ceiling is carved from its parent · set by an admin
							</p>
						</div>

						<!-- request a higher ceiling → a pending budget_requests row (real backend) -->
						<div class="space-y-3 p-5">
							<p class="text-xs uppercase tracking-wider text-ink-mute">Request a higher ceiling</p>
							{#if reqSent}
								<div
									class="flex items-start gap-2 rounded-md border border-paper-edge bg-accent-soft p-3"
								>
									<span
										class="i-solar-check-circle-bold-duotone mt-0.5 h-4 w-4 shrink-0 text-accent"
									></span>
									<p class="text-sm text-ink">
										Requested a new ceiling of <b>{money(reqSent.cap)}</b> for
										<b>{reqSent.node}</b> · pending admin approval.
									</p>
								</div>
								<button
									type="button"
									onclick={() => (reqSent = null)}
									class="rounded-md border border-paper-edge bg-paper px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-mute"
									>Request another</button
								>
							{:else}
								<div class="flex flex-wrap gap-2">
									{#each [100, 250, 500] as amt (amt)}
										<button
											type="button"
											onclick={() => (delta = amt)}
											class="rounded-md border px-3 py-1.5 font-mono text-sm transition-colors {delta ===
											amt
												? 'border-accent bg-accent-soft text-accent'
												: 'border-paper-edge bg-paper text-ink-soft hover:bg-paper-mute'}"
											>+{money(amt)}</button
										>
									{/each}
								</div>
								<input
									bind:value={reason}
									placeholder="Reason (optional) — e.g. Q2 reporting push"
									class="w-full rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
								/>
								<div class="flex items-center gap-3">
									<button
										type="button"
										onclick={sendRequest}
										disabled={reqBusy}
										class="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
									>
										<span class="i-solar-arrow-right-bold-duotone h-3.5 w-3.5"></span>
										{reqBusy ? 'Sending…' : 'Send to admin'}
									</button>
									<span class="font-mono text-xs text-ink-mute">
										{money(base)} → <b class="text-ink-soft">{money(requestedCap)}</b>
									</span>
								</div>
								{#if reqError}
									<p class="text-xs text-danger">{reqError}</p>
								{/if}
							{/if}

							{#if pending.length}
								<div class="border-t border-paper-edge pt-3">
									<p class="mb-2 text-xs uppercase tracking-wider text-ink-mute">
										Pending requests · {pending.length}
									</p>
									<div class="space-y-1.5">
										{#each pending as p (p.id)}
											<div class="flex items-center gap-2 text-xs">
												<span class="i-solar-hourglass-line-duotone h-3.5 w-3.5 text-warning"
												></span>
												<span class="font-mono text-ink-soft">{money(p.requested_cap)}</span>
												<span class="flex-1 truncate text-ink-mute">{p.reason ?? '—'}</span>
												<Chip tone="warning">{p.status}</Chip>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</Card>

			<Card flush>
				<CardHead title="Audit ledger" meta={`${filteredEvents.length}/${events.length}`} />
				<div class="overflow-auto">
					<table class="w-full text-xs">
						<thead
							class="text-xs uppercase tracking-wider text-ink-mute [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium"
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
									><td colspan="4"
										><Empty
											icon="i-solar-history-bold-duotone"
											message={events.length === 0 ? 'No audit events yet' : 'No events match'}
											pad="py-8"
										/></td
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
