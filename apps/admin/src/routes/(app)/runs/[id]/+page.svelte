<script>
	import { onMount } from 'svelte'
	import { resolve } from '$app/paths'
	import { page } from '$app/state'
	import { AppShell, PageHeader, Card, CardHead, Chip, Meter, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import {
		attemptTone,
		filteredOut,
		rankingInForce,
		rankingLine,
		routeOrder,
		summarizeTrace
	} from '$lib/requests'
	import { bookedPct, spendNote, statusLabel, statusTone, usd } from '$lib/runs'

	// One orchestrator run, end to end (System One §9.2): the calls it made, what they cost,
	// and the budget unit governance charged for them. Reached from the runs list, or from a
	// call's `run_id` on Usage patterns; the run id IS the URL, so a run is addressable rather
	// than a screen you could only arrive at by clicking.
	//
	// Cold-loadable too, which is what makes sharing a run URL worth anything: $lib/api.ts mirrors
	// the session into the httpOnly cookie the server guard reads, and kavach.config.js admits the
	// route for signed-in members. Without both, this URL was a 401 → /signin on any reload.
	/** @type {import('$lib/api').RunDetail | null} */
	let run = $state(null)
	/** @type {import('$lib/api').RequestRow[]} */
	let calls = $state([])
	let error = $state('')
	let loading = $state(true)

	const id = $derived(page.params.id ?? '')
	const short = $derived(id.slice(0, 8))
	/** booked share of the run's limit; null when it was admitted with no money cap. */
	const pct = $derived(run ? bookedPct(run.booked_usd, run.limit_usd) : null)
	/** the sentence explaining the booked-vs-calls gap, '' when they agree. */
	const note = $derived(run ? spendNote(run) : '')

	onMount(async () => {
		try {
			const res = await api.run(id)
			run = res.run
			calls = res.calls
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	// ── inline routing traces: why each call went where it went ────────────────
	// The run is where a call's cost and its routing decision belong on one screen: "this call
	// cost $0.012 and here is the chain that answered it". The trace is fetched per call, on
	// first expand — a run can hold many calls, and most of the time nobody opens one.
	//
	// A trace answers three questions, and the panel below shows all three: what was tried and why
	// it fell back (`summarizeTrace` + the attempts), WHAT ORDER was in force and under whose
	// measurement (`routing` — the ranking's category and revision, §9.6), and WHO was left out
	// (`skipped` — each withheld model with its gate's reason). The last two are written by the
	// engine, which is the only writer that has selection's own detail; the API's chat-path writer
	// leaves them empty, so their absence is a fact about the row, not a bug here.
	/** the call whose trace is open (null = every row collapsed). @type {string | null} */
	let openCall = $state(null)
	/**
	 * Per-call trace state, keyed by call id. Kept for the life of the screen so re-opening a row
	 * does not re-fetch it.
	 * @type {Record<string, { loading: boolean; trace: import('$lib/api').RoutingTrace | null; error: string }>}
	 */
	let traces = $state({})

	/** @param {import('$lib/api').RequestRow} c */
	async function toggleTrace(c) {
		if (openCall === c.id) {
			openCall = null
			return
		}
		openCall = c.id
		if (traces[c.id]) return
		traces[c.id] = { loading: true, trace: null, error: '' }
		try {
			const res = await api.requestTrace(c.id)
			traces[c.id] = { loading: false, trace: res.trace, error: '' }
		} catch (e) {
			traces[c.id] = {
				loading: false,
				trace: null,
				error: e instanceof Error ? e.message : String(e)
			}
		}
	}

	/** @param {string | null} s */
	const fmtWhen = (s) => (s ? new Date(s).toLocaleString() : '—')
	/** @param {string} s */
	const fmtTime = (s) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	/** @param {string} status */
	const callTone = (status) => (status === 'success' ? 'success' : 'danger')
	/** @param {number | null} n */
	const tokens = (n) => (n == null ? '—' : n.toLocaleString())
</script>

<AppShell app="admin" title="Run">
	<PageHeader
		eyebrow="Run"
		title={short ? `Run ${short}` : 'Run'}
		sub={run
			? `${statusLabel(run.status)} · ${run.totals.calls} call${run.totals.calls === 1 ? '' : 's'} · charged to ${run.attributed_to?.name ?? 'no unit'}`
			: 'One orchestrator run: the calls it made, what they cost, and the unit that paid.'}
	>
		{#snippet actions()}
			<a
				href={resolve('/runs')}
				class="inline-flex items-center gap-1.5 rounded-md border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-mute"
			>
				<span class="i-solar-arrow-left-linear h-3.5 w-3.5"></span>
				All runs
			</a>
		{/snippet}
	</PageHeader>

	{#if loading}
		<Async loading />
	{:else if error || !run}
		<div class="px-4 sm:px-6 xl:px-12">
			<Card pad>
				<p class="text-sm text-ink-soft">
					{error || 'No run to show.'} — a run is readable only by the tenant that was charged for it,
					and only once it has a charge row.
				</p>
			</Card>
		</div>
	{:else}
		<div class="space-y-6 px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			<!-- the four facts worth seeing first -->
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<Card class="p-4">
					<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">Calls</div>
					<div class="font-heading text-2xl font-light leading-none text-ink">
						{run.totals.calls.toLocaleString()}
					</div>
					<div class="mt-1.5 font-mono text-xs text-ink-mute">
						{run.totals.failed > 0 ? `${run.totals.failed} failed` : 'none failed'}
					</div>
				</Card>
				<Card class="p-4">
					<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">
						Call spend
					</div>
					<div class="font-heading text-2xl font-light leading-none text-ink">
						{usd(run.totals.cost_usd)}
					</div>
					<div class="mt-1.5 font-mono text-xs text-ink-mute">priced per call</div>
				</Card>
				<Card class="p-4">
					<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">Booked</div>
					<div class="font-heading text-2xl font-light leading-none text-ink">
						{usd(run.booked_usd)}
					</div>
					<div class="mt-1.5 font-mono text-xs text-ink-mute">
						{run.settled ? 'settled' : 'still open'}
					</div>
				</Card>
				<Card class="p-4">
					<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">Limit</div>
					<div class="font-heading text-2xl font-light leading-none text-ink">
						{run.limit_usd > 0 ? usd(run.limit_usd) : '—'}
					</div>
					<div class="mt-1.5 font-mono text-xs text-ink-mute">
						{run.limit_usd > 0 ? 'admitted at submit' : 'no money cap'}
					</div>
				</Card>
			</div>

			<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
				<!-- the ledger rows: what this run actually bought -->
				<Card flush>
					<CardHead title="Calls this run made" icon="i-solar-cpu-bold-duotone">
						{#snippet right()}
							<span class="font-mono text-xs text-ink-mute">
								{run.totals.calls} call{run.totals.calls === 1 ? '' : 's'} · {usd(
									run.totals.cost_usd
								)}
							</span>
						{/snippet}
					</CardHead>

					{#if calls.length}
						<div>
							{#each calls as c (c.id)}
								{@const open = openCall === c.id}
								{@const t = traces[c.id]}
								{@const ranking = rankingInForce(t?.trace ?? null)}
								{@const order = routeOrder(t?.trace ?? null)}
								{@const withheld = filteredOut(t?.trace ?? null)}
								<div class="border-b border-paper-edge last:border-b-0">
									<!-- the whole row opens the call's routing trace: one click from "this cost
									     money" to "this is what answered it". -->
									<button
										type="button"
										data-call-row={c.id}
										aria-expanded={open}
										onclick={() => toggleTrace(c)}
										class="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-paper-mute/40"
									>
										<span class="w-12 shrink-0 font-mono text-xs text-ink-mute"
											>{fmtTime(c.recorded_at)}</span
										>
										<span class="w-20 shrink-0 truncate font-mono text-xs text-ink-soft"
											>{c.adapter}</span
										>
										<span class="flex min-w-0 flex-1 items-center gap-2 text-sm">
											<span class="truncate font-semibold text-ink">{c.model}</span>
											<!-- a decision call is a different axis, not an odd chat call -->
											{#if c.capability && c.capability !== 'chat'}
												<Chip tone="accent">{c.capability}</Chip>
											{/if}
											{#if c.fallback_sequence > 1}
												<Chip tone="mute">fallback {c.fallback_sequence}</Chip>
											{/if}
										</span>
										<span class="hidden shrink-0 font-mono text-xs text-ink-mute sm:block">
											{tokens(c.input_tokens)} → {tokens(c.output_tokens)}
										</span>
										<span class="w-16 shrink-0 text-right font-mono text-xs text-ink-mute"
											>{usd(c.cost_usd)}</span
										>
										<Chip tone={callTone(c.status)}>{c.status}</Chip>
										<span
											class="i-solar-alt-arrow-down-linear h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform {open
												? 'rotate-180'
												: ''}"
										></span>
									</button>

									{#if open}
										<!-- the same trace the Usage patterns screen shows, worded by the same
										     helper (summarizeTrace) so the two cannot describe one call differently. -->
										<div
											data-trace
											class="space-y-3 border-t border-dashed border-paper-edge bg-paper-mute/30 px-6 py-4"
										>
											{#if t?.loading}
												<p class="text-sm text-ink-mute">Tracing…</p>
											{:else if t?.error}
												<p class="text-sm text-ink-soft">Couldn’t load the trace — {t.error}</p>
											{:else if t?.trace}
												{#if t.trace.attempts.length}
													<p data-why class="text-sm text-ink-soft">
														{summarizeTrace(t.trace, c.chain_id)}
													</p>
													<ol class="space-y-1.5">
														{#each t.trace.attempts as a (a.sequence)}
															<li data-attempt class="flex items-center gap-2 text-xs">
																<span class="w-4 shrink-0 font-mono text-ink-faint"
																	>{a.sequence}</span
																>
																<Chip tone={attemptTone(a.status)}>{a.status}</Chip>
																<span class="min-w-0 flex-1 truncate text-ink"
																	>{a.adapter} → {a.model}</span
																>
																<span class="shrink-0 font-mono text-ink-mute"
																	>{a.duration_ms}ms</span
																>
															</li>
														{/each}
													</ol>
													{#each t.trace.attempts.filter((a) => a.error) as a (a.sequence)}
														<p class="text-xs text-danger">↳ {a.adapter}: {a.error}</p>
													{/each}
												{/if}

												<!-- the ranking IN FORCE: which order selection handed the walk, and the
												     measurement it obeyed (System One §9.6). Written by the engine, so a
												     run's calls carry it; absent when no strategy ran at all. -->
												{#if t.trace.routing}
													<div
														data-ranking
														class="space-y-1 rounded-md border border-paper-edge bg-paper/60 px-3 py-2"
													>
														<div class="flex flex-wrap items-center gap-2">
															<span
																class="text-xs font-medium uppercase tracking-widest text-ink-mute"
																>Ranking in force</span
															>
															<Chip tone="mute">{t.trace.routing.strategy}</Chip>
															{#if t.trace.routing.degraded}
																<Chip tone="warning">degraded to priority</Chip>
															{/if}
														</div>
														{#if order.length}
															<p data-ranking-order class="font-mono text-xs text-ink-soft">
																Order it would try: {order.join(' → ')}
															</p>
														{/if}
														<p data-ranking-source class="text-xs text-ink-soft">
															{ranking
																? rankingLine(ranking)
																: 'No measured ranking was in force for this call.'}
														</p>
														{#if ranking?.unmatched.length}
															<p data-ranking-unmatched class="font-mono text-xs text-ink-mute">
																Not on this chain: {ranking.unmatched.join(', ')}
															</p>
														{/if}
													</div>
												{/if}

												<!-- WHO NEVER GOT A CHANCE: each withheld model with its gate's own reason,
												     so "why not the cheap local one" is answerable here. -->
												{#if withheld.length}
													<div
														data-filtered
														class="space-y-1 rounded-md border border-paper-edge bg-paper/60 px-3 py-2"
													>
														<div
															class="text-xs font-medium uppercase tracking-widest text-ink-mute"
														>
															Filtered out before the call
														</div>
														<ul class="space-y-1">
															{#each withheld as s (s.router + ':' + s.model)}
																<li data-skipped class="text-xs text-ink-soft">
																	<span class="font-mono">{s.router}:{s.model}</span> — {s.reason}
																</li>
															{/each}
														</ul>
													</div>
												{/if}
											{:else}
												<p class="text-sm text-ink-mute">
													No routing trace recorded for this call.
												</p>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<Empty
							icon="i-solar-cpu-bold-duotone"
							message={run.status === 'waking' || run.status === 'paused'
								? 'No calls yet — the run has not reached a model step.'
								: 'No calls recorded for this run.'}
							pad="py-8"
						/>
					{/if}

					<div
						class="flex items-start gap-2 border-t border-dashed border-paper-edge px-6 py-3 text-xs text-ink-mute"
					>
						<span class="i-solar-info-circle-linear mt-0.5 h-3.5 w-3.5 shrink-0"></span>
						<span>
							These are this run's rows in the inference ledger — the same rows Usage patterns
							lists, filtered by run. Token counts are what the provider reported. Open a call to
							see why it went where it went: the chain that answered it, every model it tried first,
							what triggered each fallback, the ranking it was ordered by (with the artifact
							revision that was in force), and the models that were filtered out before it. The last
							two are recorded only for a call the engine made inside a run, so a chat call shows
							the chain alone.
						</span>
					</div>
				</Card>

				<!-- where the money went: the charged unit, the cap, and the run's identity -->
				<div class="space-y-6">
					<Card flush>
						<CardHead title="Attribution" icon="i-solar-wallet-2-bold-duotone">
							{#snippet right()}
								<Chip tone={statusTone(run.status)}>{statusLabel(run.status)}</Chip>
							{/snippet}
						</CardHead>
						<div class="space-y-3 px-6 py-5">
							{#if run.attributed_to}
								<div>
									<div class="font-heading text-lg font-light leading-none text-ink">
										{run.attributed_to.name}
									</div>
									<div class="mt-1 flex items-center gap-2">
										{#if run.attributed_to.level_label}
											<Chip tone="mute">{run.attributed_to.level_label}</Chip>
										{/if}
										<span class="font-mono text-xs text-ink-mute">
											level {run.attributed_to.level}
										</span>
									</div>
								</div>
							{:else}
								<p class="text-sm text-ink-soft">
									This run has no charged unit — its calls roll up to nobody.
								</p>
							{/if}

							{#if pct != null}
								<div class="space-y-1.5">
									<Meter value={pct} max={100} tone="ink" />
									<div class="flex justify-between font-mono text-xs text-ink-mute">
										<span>{usd(run.booked_usd)} booked</span>
										<span>{usd(run.limit_usd)} limit</span>
									</div>
								</div>
							{:else}
								<p class="font-mono text-xs text-ink-mute">
									{usd(run.booked_usd)} booked · no money cap
								</p>
							{/if}

							{#if note}
								<p class="text-xs text-ink-soft">{note}</p>
							{/if}

							{#if run.reason}
								<p class="text-xs text-danger">↳ {run.reason}</p>
							{/if}

							<dl class="space-y-1.5 border-t border-paper-edge pt-3 text-xs">
								<div class="flex items-center justify-between gap-3">
									<dt class="text-ink-mute">Run id</dt>
									<dd class="truncate font-mono text-ink-soft" title={run.run_id}>
										{run.run_id}
									</dd>
								</div>
								<div class="flex items-center justify-between gap-3">
									<dt class="text-ink-mute">Submitted</dt>
									<dd class="text-ink-soft">{fmtWhen(run.submitted_at)}</dd>
								</div>
								<div class="flex items-center justify-between gap-3">
									<dt class="text-ink-mute">Last activity</dt>
									<dd class="text-ink-soft">{fmtWhen(run.updated_at)}</dd>
								</div>
							</dl>
						</div>
					</Card>
				</div>
			</div>
		</div>
	{/if}
</AppShell>
