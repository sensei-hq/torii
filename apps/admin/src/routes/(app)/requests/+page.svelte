<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip, Meter, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import { matchesRequest } from '$lib/filters'
	import {
		usageStats,
		usageByModel,
		groupByStatus,
		triageSummary,
		toCsv,
		csvFilename,
		money
	} from '$lib/requests'

	// The admin Requests screen is an operational lens (mock: scope='org'), NOT a raw ledger:
	// what's falling back and what's being used, with the exceptions worth a look. Who-did-what
	// and policy breaches live in Governance; the member budget cascade is the Torii Activity
	// screen. Every figure here is REAL, from /v1/requests.
	/** @type {import('$lib/api').RequestRow[]} */
	let requests = $state([])
	let error = $state('')
	let loading = $state(true)

	// Client-side filters over the fetched window (a bounded 200-row page → instant, no re-fetch).
	let q = $state('')
	let statusFilter = $state('all') // 'all' | a specific exception status

	onMount(async () => {
		try {
			const r = await api.requests(200)
			requests = r.requests
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	// ── header lens ──────────────────────────────────────────────────────────
	const stats = $derived(usageStats(requests))
	const usage = $derived(usageByModel(requests))

	// ── exception triage: the real exception buckets (status-grouped) + instances ──
	const groups = $derived(groupByStatus(requests))
	const exceptionGroups = $derived(groups.filter((g) => g.isException))
	const triage = $derived(triageSummary(groups))
	/** @param {string} status */
	const toneOf = (status) =>
		groups.find((g) => g.status === (status || 'unknown').toLowerCase())?.tone ?? 'warning'
	const needle = $derived(q.trim().toLowerCase())
	// Only exceptions are listed — "healthy calls aren't listed" (mock). Narrow by search + status.
	const instances = $derived(
		requests
			.filter((r) => (r.status || 'unknown').toLowerCase() !== 'success')
			.filter((r) => matchesRequest(r, needle, 'all'))
			.filter(
				(r) => statusFilter === 'all' || (r.status || 'unknown').toLowerCase() === statusFilter
			)
	)

	// The five header tiles. Two are real; the fallback/step-down/failover splits need the
	// per-call routing trace (GH-5, backend pass) → rendered "—", not faked.
	const tiles = $derived([
		{
			label: 'Calls · 24h',
			value: stats.calls24h.toLocaleString(),
			sub: 'across the org',
			deferred: false
		},
		{ label: 'Fallback rate', value: '—', sub: 'routing trace · soon', deferred: true },
		{ label: 'Step-downs', value: '—', sub: 'routing trace · soon', deferred: true },
		{ label: 'Failovers', value: '—', sub: 'routing trace · soon', deferred: true },
		{ label: 'Avg cost', value: fmtCost(stats.avgCost), sub: 'per call', deferred: false }
	])

	function exportCsv() {
		const blob = new Blob([toCsv(requests)], { type: 'text/csv;charset=utf-8' })
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
	function fmtCost(c) {
		return '$' + Number(c || 0).toFixed(3)
	}
	/** @param {import('$lib/requests').Tone} tone */
	const dotClass = (tone) =>
		tone === 'success'
			? 'bg-success'
			: tone === 'danger'
				? 'bg-danger'
				: tone === 'warning'
					? 'bg-warning'
					: 'bg-ink-mute'
</script>

<AppShell app="admin" title="Usage patterns">
	<PageHeader
		eyebrow="Usage patterns"
		title="Routing & usage health"
		sub="Where the gateway is falling back and what’s being used — with the exceptions worth a look. Who-did-what and policy breaches live in Governance."
	>
		{#snippet actions()}
			<button
				type="button"
				onclick={exportCsv}
				disabled={requests.length === 0}
				class="inline-flex items-center gap-1.5 rounded-md border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-mute disabled:cursor-not-allowed disabled:opacity-50"
			>
				<span class="i-solar-upload-minimalistic-bold-duotone h-3.5 w-3.5"></span>
				Export · CSV
			</button>
		{/snippet}
	</PageHeader>

	{#if loading}
		<Async loading />
	{:else if error}
		<div class="px-4 sm:px-6 xl:px-12">
			<Card pad>
				<p class="text-sm text-ink-soft">
					{error} — sign in (the gateway requires a session JWT).
				</p>
			</Card>
		</div>
	{:else}
		<div class="space-y-6 px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			<!-- five-tile header lens -->
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
				{#each tiles as t (t.label)}
					<Card class="p-4">
						<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">
							{t.label}
						</div>
						<div
							class="font-heading text-2xl font-light leading-none {t.deferred
								? 'text-ink-faint'
								: 'text-ink'}"
						>
							{t.value}
						</div>
						<div class="mt-1.5 font-mono text-xs text-ink-mute">{t.sub}</div>
					</Card>
				{/each}
			</div>

			<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
				<!-- left column: what's falling back · what's being used -->
				<div class="space-y-6">
					<Card flush>
						<CardHead title="What’s falling back · 24h" icon="i-solar-routing-2-bold-duotone">
							{#snippet right()}
								<span class="font-mono text-xs text-ink-mute">
									{triage.exceptions} of {triage.total} call{triage.total === 1 ? '' : 's'}
								</span>
							{/snippet}
						</CardHead>

						<!-- real exception buckets (status-grouped). Fine-grained fallback classification
						     — step-down vs failover vs free-floor — arrives with the routing trace. -->
						{#if exceptionGroups.length}
							<div class="grid grid-cols-1 sm:grid-cols-2">
								{#each exceptionGroups as g (g.status)}
									<button
										type="button"
										onclick={() => toggleStatus(g.status)}
										aria-pressed={statusFilter === g.status}
										class="flex items-center gap-3 border-b border-paper-edge px-6 py-3 text-left transition-colors hover:bg-paper-mute/40 sm:odd:border-r {statusFilter ===
										g.status
											? 'bg-paper-mute'
											: ''}"
									>
										<span class="h-2 w-2 shrink-0 rounded-full {dotClass(g.tone)}"></span>
										<div class="min-w-0 flex-1">
											<div class="text-sm font-semibold text-ink">{g.label}</div>
											<div class="font-mono text-xs text-ink-mute">{money(g.cost)} · {g.pct}%</div>
										</div>
										<span class="font-heading text-xl font-light text-ink">{g.count}</span>
									</button>
								{/each}
							</div>
						{:else}
							<Empty
								icon="i-solar-check-circle-bold-duotone"
								message="No routing exceptions in this window — every call was served cleanly."
								pad="py-8"
							/>
						{/if}

						<CardHead title="Instances worth a look">
							{#snippet right()}
								<div class="flex items-center gap-3">
									{#if statusFilter !== 'all'}
										<button
											type="button"
											onclick={() => (statusFilter = 'all')}
											class="inline-flex items-center gap-1 rounded-full bg-paper-mute px-2 py-0.5 text-xs text-ink-soft hover:text-ink"
										>
											{statusFilter}
											<span class="i-solar-close-circle-bold-duotone h-3 w-3"></span>
										</button>
									{/if}
									<div class="relative">
										<span
											class="i-solar-magnifer-linear pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
										></span>
										<input
											bind:value={q}
											aria-label="Filter exception instances"
											placeholder="user, model, task…"
											class="w-40 rounded-md border border-paper-edge bg-paper py-1 pl-8 pr-2 text-xs text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
										/>
									</div>
								</div>
							{/snippet}
						</CardHead>

						{#if instances.length}
							<div>
								{#each instances as r (r.id)}
									<div
										class="flex items-center gap-3 border-b border-paper-edge px-6 py-2.5 last:border-b-0"
									>
										<span class="h-[7px] w-[7px] shrink-0 rounded-full {dotClass(toneOf(r.status))}"
										></span>
										<span class="w-12 shrink-0 font-mono text-xs text-ink-mute"
											>{fmtTime(r.recorded_at)}</span
										>
										<span class="w-20 shrink-0 truncate font-mono text-xs text-ink-soft"
											>{r.adapter}</span
										>
										<span class="flex min-w-0 flex-1 items-center gap-2 text-sm">
											<span class="truncate font-semibold text-ink">{r.model}</span>
										</span>
										<span class="shrink-0 font-mono text-xs text-ink-mute">{money(r.cost_usd)}</span
										>
										<Chip tone={toneOf(r.status)}>{r.status}</Chip>
									</div>
								{/each}
							</div>
						{:else}
							<Empty
								icon="i-solar-clipboard-list-bold-duotone"
								message={triage.total === 0 ? 'No calls yet' : 'No exceptions match this view.'}
								pad="py-8"
							/>
						{/if}

						<div
							class="flex items-start gap-2 border-t border-dashed border-paper-edge px-6 py-3 text-xs text-ink-mute"
						>
							<span class="i-solar-info-circle-linear mt-0.5 h-3.5 w-3.5 shrink-0"></span>
							<span>
								Healthy calls aren’t listed — only exceptions. Fine-grained fallback classification
								(step-down · failover · free-floor) arrives with the per-call routing trace. For
								who-accessed-what and policy breaches, see <b class="text-ink-soft">Governance</b>.
							</span>
						</div>
					</Card>

					<Card flush>
						<CardHead title="What’s being used · 24h" icon="i-solar-cpu-bold-duotone">
							{#snippet right()}
								<span class="font-mono text-xs text-ink-mute"
									>{requests.length.toLocaleString()} call{requests.length === 1 ? '' : 's'}</span
								>
							{/snippet}
						</CardHead>
						{#if usage.length}
							<div class="px-6 py-2">
								{#each usage as m (m.model)}
									<div
										class="flex items-center gap-3 border-b border-paper-edge py-2.5 last:border-b-0"
									>
										<span class="h-2 w-2 shrink-0 rounded-full bg-ink-mute"></span>
										<span class="w-36 shrink-0 truncate font-mono text-sm font-semibold text-ink"
											>{m.model}</span
										>
										<div class="flex-1">
											<Meter value={m.share} max={100} tone="ink" />
										</div>
										<span class="w-20 shrink-0 text-right font-mono text-xs text-ink-mute"
											>{m.calls.toLocaleString()} · {m.share}%</span
										>
									</div>
								{/each}
							</div>
						{:else}
							<Empty
								icon="i-solar-cpu-bold-duotone"
								message="No model traffic yet — usage will chart here as calls flow."
								pad="py-8"
							/>
						{/if}
					</Card>
				</div>

				<!-- right column: "why this model" trace — deferred to the routing-trace backend -->
				<div>
					<Card flush class="xl:sticky xl:top-4">
						<CardHead title="Why this model" icon="i-solar-routing-bold-duotone" />
						<div class="flex flex-col items-start gap-3 px-6 py-6">
							<span class="i-solar-routing-bold-duotone h-6 w-6 text-ink-faint"></span>
							<p class="text-sm text-ink-soft">
								Select an exception to trace it — the step-by-step routing decision (requested vs
								served model, budget checks, guardrails, citations) surfaces here.
							</p>
							<p class="text-xs text-ink-mute">
								The per-call routing trace ships with the trace backend (GH-5); until then this
								panel stays intentionally empty rather than showing invented reasoning.
							</p>
						</div>
					</Card>
				</div>
			</div>
		</div>
	{/if}
</AppShell>
