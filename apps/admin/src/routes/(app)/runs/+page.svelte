<script>
	import { onMount } from 'svelte'
	import { resolve } from '$app/paths'
	import { AppShell, PageHeader, Card, CardHead, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import {
		bookingPending,
		currentSpend,
		filterLabel,
		narrowed,
		nextCursor,
		RUN_STATUS_FILTERS,
		statusLabel,
		statusTone,
		usd
	} from '$lib/runs'

	// System One §9.2: the orchestrator runs this workspace has been charged for, newest first.
	// Each row is the same header the run screen serves (one gateway projection), so this is a
	// place to start reading a run — never a second version of its numbers.
	//
	// Three things make an unbounded ledger readable, and the gateway does all three: the tenant
	// filter, the lifecycle filter, and the keyset cursor. Only the presentation lives here.
	/** @type {import('$lib/api').RunDetail[]} */
	let runs = $state([])
	let error = $state('')
	/** first paint — nothing to keep on screen yet. */
	let loading = $state(true)
	/** a refetch under a filter: the rows are replaced, so the chips have to stay put. */
	let busy = $state(false)
	let moreLoading = $state(false)
	/** is there an older page the gateway knows about? */
	let hasMore = $state(false)
	/** @type {import('$lib/runs').RunStatusFilter} */
	let status = $state('all')
	/** only runs whose calls include a failure — not the same question as the run's own status. */
	let failedOnly = $state(false)

	const PAGE = 50
	const filters = ['all', ...RUN_STATUS_FILTERS]

	/** one page, from the newest end or from a cursor. @param {import('$lib/api').RunCursor | null} before */
	async function fetchPage(before) {
		const res = await api.runs({
			limit: PAGE,
			before,
			status: status === 'all' ? undefined : status,
			failedOnly
		})
		return res
	}

	onMount(async () => {
		try {
			const res = await fetchPage(null)
			runs = res.runs
			hasMore = res.has_more
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	/**
	 * Narrow to one lifecycle state. The filter is the gateway's, not the client's: the list shows
	 * a page of a ledger that is unbounded, so filtering here could only ever filter the rows this
	 * page happens to hold.
	 * @param {import('$lib/runs').RunStatusFilter} f
	 */
	async function setFilter(f) {
		if (f === status || busy) return
		status = f
		await reload()
	}

	/**
	 * Show only runs that had a failed call. A toggle of its own rather than a seventh chip: it is a
	 * different question from the lifecycle — `Failed` is how the run ended, this is whether
	 * anything inside it failed, which a completed run that fell back also answers — so it composes
	 * with the chip instead of competing with it.
	 */
	async function toggleFailedCalls() {
		if (busy) return
		failedOnly = !failedOnly
		await reload()
	}

	/** Refetch the newest page under the current filters. */
	async function reload() {
		busy = true
		error = ''
		// the rows on screen answer the previous question — drop them rather than have them read
		// as the filter's answer while the new page loads.
		runs = []
		hasMore = false
		try {
			const res = await fetchPage(null)
			runs = res.runs
			hasMore = res.has_more
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	/** Walk back one page through the ledger, carrying the filter with the cursor. */
	async function loadOlder() {
		if (moreLoading) return
		const before = nextCursor({ runs, has_more: hasMore })
		if (!before) return
		moreLoading = true
		error = ''
		try {
			const res = await fetchPage(before)
			runs = [...runs, ...res.runs]
			hasMore = res.has_more
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			moreLoading = false
		}
	}

	/** everything the loaded rows have cost so far, priced per call. */
	const pageSpend = $derived(runs.reduce((sum, r) => sum + currentSpend(r), 0))
	/** loaded runs whose booking has not caught up with their calls — still spending, or not settled. */
	const pending = $derived(runs.filter((r) => bookingPending(r)).length)

	/** @param {string | null} s */
	const fmtWhen = (s) => (s ? new Date(s).toLocaleString() : '—')
	/** @param {number | null} n */
	const count = (n) => (n == null ? '—' : n.toLocaleString())
	/** @param {import('$lib/api').RunDetail} r */
	const short = (r) => r.run_id.slice(0, 8)
</script>

<AppShell app="admin" title="Runs">
	<PageHeader
		eyebrow="Runs"
		title="Orchestrator runs"
		sub="Every run this workspace has been charged for, newest first: how it ended, what it has cost so far, and the budget unit that paid. A run appears here from the moment it is admitted — a charge is legible before the scheduler has written a lifecycle row."
	>
		{#snippet actions()}
			<a
				href={resolve('/requests')}
				class="inline-flex items-center gap-1.5 rounded-md border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-mute"
			>
				<span class="i-solar-clipboard-list-bold-duotone h-3.5 w-3.5"></span>
				Usage patterns
			</a>
		{/snippet}
	</PageHeader>

	{#if loading}
		<Async loading />
	{:else}
		<div class="space-y-6 px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			{#if error}
				<Card pad
					><p class="text-sm text-danger" role="alert">
						{error}{error.includes('403')
							? ' — runs are part of the audit ledger, so reading them needs audit.read (owner/admin).'
							: ''}
					</p></Card
				>
			{/if}

			<Card flush>
				<CardHead title="Runs" icon="i-solar-play-circle-bold-duotone">
					{#snippet right()}
						<span class="font-mono text-xs text-ink-mute">
							{runs.length} run{runs.length === 1 ? '' : 's'} · {usd(pageSpend)} spent
							{#if pending > 0}· {pending} unbooked{/if}
						</span>
					{/snippet}
				</CardHead>

				<!-- the lifecycle filter: one chip per state the gateway accepts, so the control and
				     the read cannot disagree about what a run can be. -->
				<div
					class="flex flex-wrap items-center gap-1.5 border-b border-paper-edge px-4 py-2.5 sm:px-6"
				>
					{#each filters as f (f)}
						<button
							type="button"
							data-run-filter={f}
							aria-pressed={status === f}
							onclick={() => setFilter(f)}
							class="rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors {status ===
							f
								? 'border-ink/25 bg-paper-mute text-ink'
								: 'border-paper-edge text-ink-mute hover:bg-paper-mute/60 hover:text-ink-soft'}"
						>
							{filterLabel(f)}
						</button>
					{/each}

					<!-- a second axis, set apart from the lifecycle chips: it narrows whatever state is
					     selected rather than replacing it. -->
					<button
						type="button"
						data-run-filter="failed-calls"
						aria-pressed={failedOnly}
						onclick={toggleFailedCalls}
						class="ml-auto flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors {failedOnly
							? 'border-danger/30 bg-danger-soft text-danger'
							: 'border-paper-edge text-ink-mute hover:bg-paper-mute/60 hover:text-ink-soft'}"
					>
						<span class="i-solar-danger-triangle-linear h-3 w-3"></span>
						Failed calls
					</button>
				</div>

				{#if busy}
					<div class="px-4 py-10 sm:px-6">
						<p class="text-sm text-ink-mute">Reading the ledger…</p>
					</div>
				{:else if runs.length}
					<div>
						{#each runs as r (r.run_id)}
							<a
								href={resolve('/runs/[id]', { id: r.run_id })}
								data-run-row={r.run_id}
								class="group grid grid-cols-[84px_minmax(0,1fr)_auto] items-center gap-3 border-b border-paper-edge px-4 py-3 transition-colors last:border-b-0 hover:bg-paper-mute/40 sm:px-6"
							>
								<Chip tone={statusTone(r.status)}>{statusLabel(r.status)}</Chip>

								<div class="min-w-0">
									<div class="flex min-w-0 items-center gap-2">
										<span class="shrink-0 font-mono text-sm text-ink">run {short(r)}</span>
										{#if r.attributed_to}
											<span class="min-w-0 truncate text-sm text-ink-soft">
												· {r.attributed_to.name}
											</span>
										{:else}
											<span class="shrink-0 text-sm text-ink-faint">· no charged unit</span>
										{/if}
										{#if bookingPending(r)}
											<!-- the row-level form of §9.4's gap: calls priced, booking not yet folded -->
											<Chip tone="mute">unbooked</Chip>
										{/if}
									</div>
									<div class="mt-0.5 truncate font-mono text-xs text-ink-mute">
										{fmtWhen(r.submitted_at)} · {count(r.totals.calls)} call{r.totals.calls === 1
											? ''
											: 's'}{r.totals.failed > 0 ? ` (${r.totals.failed} failed)` : ''} · booked
										{usd(r.booked_usd)}{r.limit_usd > 0 ? ` of ${usd(r.limit_usd)}` : ''}
									</div>
								</div>

								<div class="text-right">
									<div class="font-mono text-sm text-ink">{usd(currentSpend(r))}</div>
									<div
										class="font-mono text-xs text-ink-faint transition-colors group-hover:text-ink-soft"
									>
										open →
									</div>
								</div>
							</a>
						{/each}
					</div>
				{:else if !narrowed(status, failedOnly)}
					<Empty
						icon="i-solar-play-circle-bold-duotone"
						message="No runs yet"
						hint="A run appears here once it is admitted and charged — the orchestrator's spend, not just its schedule."
						pad="py-10"
					/>
				{:else}
					<Empty
						icon="i-solar-play-circle-bold-duotone"
						message="No runs match this filter"
						hint="The filters read the whole ledger, not just the newest page — so this really is every run they select."
						pad="py-10"
					/>
				{/if}

				{#if hasMore && !busy}
					<button
						type="button"
						data-more-runs
						disabled={moreLoading}
						onclick={loadOlder}
						class="w-full border-t border-paper-edge px-4 py-3 font-mono text-xs text-ink-soft transition-colors hover:bg-paper-mute/40 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6"
					>
						{moreLoading ? 'Reading older runs…' : 'Older runs →'}
					</button>
				{/if}

				<div
					class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3 text-xs text-ink-mute sm:px-6"
				>
					<span class="i-solar-info-circle-linear mt-0.5 h-3.5 w-3.5 shrink-0"></span>
					<span>
						The amount on the right is what the run's calls were priced at, so it is current. Booked
						spend is what governance has written to the run's budget nodes — a watermark that
						catches up when the run settles, which is why a live run can read $0.000 booked. A run
						with no lifecycle row is admitted but not yet scheduled; that is a state, not a failure.
						This page holds {PAGE} runs and the totals above cover the rows loaded so far: “Older runs”
						walks further back through the ledger, and the status and failed-calls filters narrow the
						whole ledger rather than the page. “Failed calls” selects runs in which at least one call
						failed — a completed run that fell back still counts, because the fallback is what explains
						its spend.
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
