<script>
	import { onMount } from 'svelte'
	import { PageHeader, Card, CardHead, Chip, Meter, Async, Empty } from '@torii/ui'
	import { activity } from '$lib/activity.svelte.js'
	import { money, nodePct, toCsv, csvFilename, summarizeTrace, attemptTone } from '$lib/activity'

	// Load seam (runbook B4): pulls the REAL ledger (/v1/requests) + budget tree (/v1/budgets).
	// The store degrades the two reads independently, so a budget denial never blanks the table.
	onMount(() => {
		activity.load()
	})

	function exportCsv() {
		const blob = new Blob([toCsv(activity.filtered)], { type: 'text/csv;charset=utf-8' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = csvFilename()
		a.click()
		URL.revokeObjectURL(url)
	}

	/** @param {string} s */
	const fmtTime = (s) =>
		new Date(s).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		})
	/** @param {number} c */
	const fmtCost = (c) => (c === 0 ? '$0' : '$' + Number(c).toFixed(4))
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

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="You"
		title="Activity"
		sub="Every request you've run — where it ran, which model answered, and what it cost."
	/>

	{#if activity.loading}
		<Async loading />
	{:else if activity.error}
		<div class="px-5">
			<Card pad
				><p class="text-sm text-ink-soft">
					{activity.error}{activity.error.includes('403')
						? ' — activity needs the audit.read capability.'
						: ''}
				</p></Card
			>
		</div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<div class="grid grid-cols-3 gap-4">
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
						Requests
					</div>
					<div class="font-heading text-2xl font-light text-ink">{activity.requests.length}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
						On-device
					</div>
					<div class="font-heading text-2xl font-light text-ink">{activity.localCount}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Spend</div>
					<div class="font-heading text-2xl font-light text-ink">{fmtCost(activity.spend)}</div>
				</Card>
			</div>

			<!-- budget ceiling + cascade: the org → … → you chain the member's cap is carved from,
			     plus the request-increase flow (a real /rpc/budgets/request write). -->
			<Card flush>
				<CardHead title="Your budget ceiling" icon="i-solar-wallet-money-bold-duotone">
					{#snippet right()}
						{#if activity.leaves.length > 1}
							<label class="flex items-center gap-2 text-xs text-ink-mute">
								<span class="uppercase tracking-wider">Ceiling</span>
								<select
									bind:value={activity.targetId}
									aria-label="Budget node"
									class="rounded-sm border border-paper-edge bg-paper px-1.5 py-1 font-mono text-xs text-ink-soft"
								>
									{#each activity.leaves as n (n.id)}
										<option value={n.id}>{n.name} · {nodePct(n)}%</option>
									{/each}
								</select>
							</label>
						{/if}
					{/snippet}
				</CardHead>
				{#if activity.budgetError}
					<p class="px-4 py-4 text-sm text-ink-mute">
						Budget tree unavailable — {activity.budgetError}{activity.budgetError.includes('403')
							? ' (needs the budget.read capability).'
							: ''}
					</p>
				{:else if !activity.nodes.length}
					<Empty
						icon="i-solar-wallet-bold-duotone"
						message="No budget ceiling seeded for this tenant."
						pad="py-8"
					/>
				{:else if activity.selected}
					<div class="grid gap-0 md:grid-cols-2">
						<!-- the chain of caps you inherit from: org → dept → you -->
						<div class="space-y-4 border-b border-paper-edge p-5 md:border-b-0 md:border-r">
							<p class="text-xs uppercase tracking-wider text-ink-mute">
								The budget you cascade from
							</p>
							{#each activity.cascade as n, i (n.id)}
								{@const last = i === activity.cascade.length - 1}
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
								At 100% the gateway keeps you working on the free local model — never a hard stop.
							</p>
						</div>

						<!-- request a higher ceiling → a pending budget_requests row (real backend) -->
						<div class="space-y-3 p-5">
							<p class="text-xs uppercase tracking-wider text-ink-mute">Request a higher ceiling</p>
							{#if activity.reqSent}
								<div
									class="flex items-start gap-2 rounded-md border border-paper-edge bg-accent-soft p-3"
								>
									<span
										class="i-solar-check-circle-bold-duotone mt-0.5 h-4 w-4 shrink-0 text-accent"
									></span>
									<p class="text-sm text-ink">
										Requested a new ceiling of <b>{money(activity.reqSent.cap)}</b> for
										<b>{activity.reqSent.node}</b> · pending admin approval.
									</p>
								</div>
								<button
									type="button"
									onclick={() => (activity.reqSent = null)}
									class="rounded-md border border-paper-edge bg-paper px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-mute"
									>Request another</button
								>
							{:else}
								<div class="flex flex-wrap gap-2">
									{#each [100, 250, 500] as amt (amt)}
										<button
											type="button"
											onclick={() => (activity.delta = amt)}
											class="rounded-md border px-3 py-1.5 font-mono text-sm transition-colors {activity.delta ===
											amt
												? 'border-accent bg-accent-soft text-accent'
												: 'border-paper-edge bg-paper text-ink-soft hover:bg-paper-mute'}"
											>+{money(amt)}</button
										>
									{/each}
								</div>
								<input
									bind:value={activity.reason}
									placeholder="Reason (optional) — e.g. Q2 reporting push"
									class="w-full rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
								/>
								<div class="flex items-center gap-3">
									<button
										type="button"
										onclick={() => activity.sendRequest()}
										disabled={activity.reqBusy}
										class="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
									>
										<span class="i-solar-arrow-right-bold-duotone h-3.5 w-3.5"></span>
										{activity.reqBusy ? 'Sending…' : 'Send to admin'}
									</button>
									<span class="font-mono text-xs text-ink-mute">
										{money(activity.base)} →
										<b class="text-ink-soft">{money(activity.requestedCap)}</b>
									</span>
								</div>
								{#if activity.reqError}
									<p class="text-xs text-danger">{activity.reqError}</p>
								{/if}
							{/if}

							{#if activity.pending.length}
								<div class="border-t border-paper-edge pt-3">
									<p class="mb-2 text-xs uppercase tracking-wider text-ink-mute">
										Pending requests · {activity.pending.length}
									</p>
									<div class="space-y-1.5">
										{#each activity.pending as p (p.id)}
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
				<CardHead title="Recent requests">
					{#snippet right()}
						<div class="flex items-center gap-3">
							<div class="relative">
								<span
									class="i-solar-magnifer-linear pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
								></span>
								<input
									bind:value={activity.q}
									aria-label="Filter requests"
									placeholder="model, status…"
									class="w-40 rounded-md border border-paper-edge bg-paper py-1 pl-8 pr-2 text-xs text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
								/>
							</div>
							<div
								class="inline-flex items-center gap-0.5 rounded-full border border-paper-edge p-0.5 text-xs"
							>
								{#each ['all', 'cloud', 'local'] as p (p)}
									<button
										type="button"
										onclick={() => (activity.plane = p)}
										class="rounded-full px-2 py-0.5 {activity.plane === p
											? 'bg-paper-mute font-medium text-accent'
											: 'text-ink-mute'}">{p}</button
									>
								{/each}
							</div>
							<button
								type="button"
								onclick={exportCsv}
								disabled={activity.filtered.length === 0}
								class="inline-flex items-center gap-1.5 rounded-md border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-mute disabled:cursor-not-allowed disabled:opacity-50"
							>
								<span class="i-solar-download-minimalistic-bold-duotone h-3.5 w-3.5"></span>
								Export CSV
							</button>
							<span class="font-mono text-xs text-ink-mute"
								>{activity.filtered.length}/{activity.requests.length}</span
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
								<th>When</th>
								<th>Model</th>
								<th>Where</th>
								<th class="!text-right">Tokens</th>
								<th class="!text-right">Cost</th>
							</tr>
						</thead>
						<tbody class="[&_td]:px-4 [&_td]:py-2">
							{#each activity.filtered as r (r.id)}
								{@const open = activity.expandedId === r.id}
								<tr
									data-request-row
									class="border-b border-paper-edge last:border-b-0 hover:bg-paper-mute/40"
								>
									<td class="font-mono text-ink-mute">
										<button
											type="button"
											data-trace-toggle
											onclick={() => activity.toggleTrace(r.id)}
											aria-expanded={open}
											title="Why this model?"
											class="inline-flex items-center gap-1 text-ink-mute hover:text-ink"
										>
											<span
												class="{open
													? 'i-solar-alt-arrow-down-linear'
													: 'i-solar-alt-arrow-right-linear'} h-3 w-3"
											></span>
											{fmtTime(r.recorded_at)}
										</button>
									</td>
									<td class="text-ink">{r.model}</td>
									<td
										><Chip tone={planeTone(r.execution_location)}
											>{r.execution_location ?? '—'}</Chip
										></td
									>
									<td class="text-right font-mono text-ink-soft"
										>{r.input_tokens ?? 0}/{r.output_tokens ?? 0}</td
									>
									<td class="text-right font-mono text-ink-soft">{fmtCost(r.cost_usd)}</td>
								</tr>
								{#if open}
									<tr data-trace class="border-b border-paper-edge bg-paper-mute/30">
										<td colspan="5" class="px-4 py-3">
											{#if activity.traceLoading === r.id}
												<p class="text-xs text-ink-mute">Loading routing trace…</p>
											{:else}
												{@const trace = activity.traceFor(r.id)}
												{#if trace && trace.attempts.length}
													<p data-why class="mb-2 text-xs text-ink-soft">
														{summarizeTrace(trace, r.chain_id)}
													</p>
													<ol class="space-y-1">
														{#each trace.attempts as a (a.sequence)}
															<li data-attempt class="flex items-center gap-2 text-xs">
																<span class="w-4 font-mono text-ink-faint">{a.sequence}</span>
																<Chip tone={attemptTone(a.status)}>{a.status}</Chip>
																<span class="text-ink">{a.adapter} → {a.model}</span>
																<span class="font-mono text-ink-mute">{a.duration_ms}ms</span>
																{#if a.error}
																	<span class="truncate text-danger" title={a.error}>{a.error}</span>
																{/if}
															</li>
														{/each}
													</ol>
												{:else}
													<p class="text-xs text-ink-mute">
														No routing trace recorded for this request.
													</p>
												{/if}
											{/if}
										</td>
									</tr>
								{/if}
							{/each}
							{#if activity.filtered.length === 0}
								<tr
									><td colspan="5"
										><Empty
											icon="i-solar-history-bold-duotone"
											message={activity.requests.length === 0
												? 'No requests yet'
												: 'No requests match'}
											hint={activity.requests.length === 0 ? 'Ask something.' : ''}
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
</section>
