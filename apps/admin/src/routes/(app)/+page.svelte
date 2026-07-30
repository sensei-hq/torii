<script>
	import { onMount } from 'svelte'
	import { resolve } from '$app/paths'
	import { goto } from '$app/navigation'
	import { AppShell, PageHeader, Card, CardHead, Stat, Meter, Chip, AlertsCard } from '@torii/ui'
	import { api } from '$lib/api'
	import { alertsState } from '$lib/alerts-state.svelte'
	import {
		execPlaneSplit,
		costTrend,
		trendSummary,
		setupSpine,
		heroInsight,
		money,
		greeting,
		displayName,
		dateEyebrow,
		avgLatencySec
	} from '$lib/overview'

	/** @type {import('$lib/api').RequestRow[]} */
	let requests = $state([])
	/** @type {import('$lib/api').BudgetNode[]} */
	let nodes = $state([])
	/** @type {import('$lib/api').AuditEvent[]} */
	let events = $state([])
	/** @type {import('$lib/api').Provider[]} */
	let providers = $state([])
	/** @type {import('$lib/api').ModelRow[]} */
	let models = $state([])
	/** @type {import('$lib/api').RoutingStep[]} */
	let steps = $state([])
	let error = $state('')
	let loading = $state(true)
	/** signed-in user's email → the header greeting name (mock: "Good morning, Aiko."). */
	let email = $state('')

	onMount(async () => {
		try {
			const [r, b, a, c, m, rt, id] = await Promise.all([
				api.requests(200),
				api.budgets(),
				api.audit(8),
				api.connections(),
				api.models(),
				api.routing(),
				api.identity()
			])
			requests = r.requests
			nodes = b.nodes
			events = a.events
			providers = c.providers
			models = m.models
			steps = rt.steps
			email = id.email ?? ''
			// Alerts derive from the reads above (ui-state-pattern Load→State seam), no new backend.
			alertsState.load({ nodes, requests, providers })
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	// header, matching the mock: date eyebrow + time-of-day greeting with the real name.
	const name = $derived(displayName(email))
	const title = $derived(name ? `${greeting()}, ${name}.` : `${greeting()}.`)
	const avgLatency = $derived(avgLatencySec(requests))
	// "today" = spend recorded on the current UTC calendar day (mock tile: "Spend · today").
	const todayKey = new Date().toISOString().slice(0, 10)
	const spendToday = $derived(
		requests
			.filter((r) => (r.recorded_at ?? '').slice(0, 10) === todayKey)
			.reduce((s, r) => s + Number(r.cost_usd || 0), 0)
	)

	// ── headline aggregates — all computed from the real ledger, no mock data ──
	const spend = $derived(requests.reduce((s, r) => s + Number(r.cost_usd || 0), 0))
	const tokens = $derived(
		requests.reduce((s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0)
	)
	// a router counts as connected when it needs no key (local) or the tenant sealed one.
	const connected = $derived(
		providers.filter((p) => p.connected || p.oauth_connected || !p.requires_key).length
	)
	const orgRoot = $derived(nodes.find((n) => n.kind === 'org') ?? nodes[0])
	const budgetPct = $derived(
		orgRoot?.cap_amount ? Math.round((orgRoot.spent_amount / orgRoot.cap_amount) * 100) : 0
	)

	// ── new depth: exec-plane split, cost trend, setup spine, hero insight ──
	const plane = $derived(execPlaneSplit(requests))
	const trend = $derived(costTrend(requests, 14))
	const tsum = $derived(trendSummary(trend))
	const setup = $derived(setupSpine(providers, models, steps))
	const hero = $derived(heroInsight({ requests, plane, spend, orgRoot, budgetPct, setup }))
	const heroTone = $derived(
		hero.tone === 'danger'
			? { box: 'bg-danger-soft', icon: 'text-danger' }
			: hero.tone === 'accent'
				? { box: 'bg-accent-soft', icon: 'text-accent' }
				: { box: 'bg-paper-mute', icon: 'text-ink-soft' }
	)

	// sparkline bar geometry over a 200×52 viewBox, one bar per trend day.
	const sparkBars = $derived.by(() => {
		const h = 52
		const gap = 3
		const w = 200
		const max = Math.max(...trend.map((p) => p.costPerCall), Number.EPSILON)
		const bw = (w - gap * (trend.length - 1)) / trend.length
		return trend.map((p, i) => ({
			day: p.day,
			x: i * (bw + gap),
			y: h - Math.max(3, (p.costPerCall / max) * h),
			w: bw,
			h: Math.max(3, (p.costPerCall / max) * h),
			last: i === trend.length - 1
		}))
	})

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

	/** @param {string} iso */
	const fmtTime = (iso) =>
		new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<AppShell app="admin" title="Overview">
	<PageHeader eyebrow={dateEyebrow()} {title}>
		{#snippet actions()}
			{#if !error && !loading}
				<span
					class="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-soft px-2.5 py-1 text-xs font-medium text-success"
				>
					<span class="i-solar-check-circle-bold-duotone h-3.5 w-3.5"></span> gateway healthy
				</span>
			{/if}
			<a
				href={resolve('/requests')}
				class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
			>
				Open playground
				<span class="i-solar-alt-arrow-right-bold-duotone h-3.5 w-3.5"></span>
			</a>
		{/snippet}
	</PageHeader>

	{#if loading}
		<p class="px-6 text-sm text-ink-mute">Loading…</p>
	{:else if error}
		<div class="px-6"><Card pad><p class="text-sm text-accent">{error}</p></Card></div>
	{:else}
		<!-- page padding matches the mock's responsive .view-pad: 24px sides ≤lg, 48px sides ≥lg (>1080),
		 responsive bottom. Uses UnoCSS lg: media modifiers rather than fixed values. -->
		<div class="space-y-6 px-6 pb-10 lg:px-12 lg:pb-12">
			<!-- hero insight — the single most salient fact today, derived from the reads -->
			<Card class="flex items-start gap-4 p-6">
				<span
					class="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-paper-edge {heroTone.box}"
				>
					<span class="{hero.icon} h-7 w-7 {heroTone.icon}"></span>
				</span>
				<div class="min-w-0 flex-1">
					<p class="font-heading text-lg leading-snug text-ink">
						{hero.lead}
						<b class="font-semibold">{hero.figure}</b>
						{hero.trail}
					</p>
					<p class="mt-1 max-w-2xl text-sm text-ink-soft">{hero.detail}</p>
				</div>
				<a
					href={resolve(hero.actionRoute)}
					class="shrink-0 rounded-md border border-paper-edge bg-paper px-3 py-1.5 text-sm text-ink transition-colors hover:bg-paper-mute"
					>{hero.actionLabel}</a
				>
			</Card>

			<!-- proactive alerts (mock's next section) — derived from budget/health/connection signals -->
			<AlertsCard
				alerts={alertsState.visible}
				onopen={(route) => goto(resolve(route))}
				ondismiss={(id) => alertsState.dismiss(id)}
			/>

			<!-- headline stats (mock: Spend·today / Calls served / Fallbacks / Avg latency), all live.
			 Fallbacks needs the per-call routing trace (Pass 2) — On-device stands in until then. -->
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<Stat
					label="Spend · today"
					value={money(spendToday)}
					hint={`${money(spend)} all-time · ${tokens.toLocaleString()} tokens`}
				/>
				<Stat label="Calls served" value={requests.length} hint="inference calls recorded" />
				<Stat
					label="Avg latency"
					value={avgLatency || '—'}
					unit={avgLatency ? 's' : ''}
					hint="mean over recorded calls"
				/>
				<Stat
					label="On-device"
					value={`${plane.localPct}%`}
					tone="accent"
					hint="ran on the local plane"
				/>
			</div>

			<!-- execution plane — on-device (local) vs via-gateway (cloud) split -->
			<Card flush>
				<CardHead title="Execution plane" icon="i-solar-server-bold-duotone">
					{#snippet right()}
						{#if plane.local > 0}
							<Chip tone="success">on-device · $0 egress</Chip>
						{:else}
							<span class="font-mono text-xs text-ink-mute">{plane.total} calls</span>
						{/if}
					{/snippet}
				</CardHead>
				<div class="p-4">
					{#if plane.total > 0}
						<div class="mb-3 flex h-2.5 overflow-hidden rounded-full bg-paper-mute">
							<div class="bg-ink-mute" style="width:{plane.cloudPct}%"></div>
							<div class="bg-success" style="width:{plane.localPct}%"></div>
						</div>
						<div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
							<span class="flex items-center gap-1.5 text-ink-soft">
								<span class="i-solar-global-bold-duotone h-3.5 w-3.5 text-ink-mute"></span>
								via gateway
								<span class="font-mono text-xs text-ink-mute"
									>· {plane.cloud} · {plane.cloudPct}% · {money(plane.cloudCost)}</span
								>
							</span>
							<span class="flex items-center gap-1.5 text-ink-soft">
								<span class="i-solar-server-bold-duotone h-3.5 w-3.5 text-success"></span>
								on device
								<span class="font-mono text-xs text-ink-mute"
									>· {plane.local} · {plane.localPct}%</span
								>
							</span>
							{#if plane.unknown > 0}
								<span class="font-mono text-xs text-ink-faint">{plane.unknown} unrecorded</span>
							{/if}
						</div>
					{:else}
						<p class="text-sm text-ink-mute">
							No requests yet — the plane split appears as calls flow.
						</p>
					{/if}
				</div>
			</Card>

			<!-- gateway setup spine — connect → register → route, with real coverage -->
			<Card flush>
				<CardHead title="Gateway setup & coverage" icon="i-solar-routing-2-bold-duotone">
					{#snippet right()}
						{#if setup.every((s) => s.done)}
							<span class="flex items-center gap-1 font-mono text-xs text-success">
								<span class="i-solar-check-circle-bold-duotone h-3.5 w-3.5"></span>fully configured
							</span>
						{:else}
							<span class="font-mono text-xs text-ink-mute"
								>{setup.filter((s) => s.done).length}/3 steps done</span
							>
						{/if}
					{/snippet}
				</CardHead>
				<div class="grid grid-cols-1 sm:grid-cols-3">
					{#each setup as s, i (s.key)}
						<a
							href={resolve(s.route)}
							class="flex flex-col gap-2.5 p-5 transition-colors hover:bg-paper-mute/40 {i > 0
								? 'border-t border-paper-edge sm:border-l sm:border-t-0'
								: ''}"
						>
							<div class="flex items-center gap-2">
								<span
									class="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-paper-edge bg-paper-mute font-mono text-xs text-ink-mute"
									>{i + 1}</span
								>
								<span class="{s.icon} h-3.5 w-3.5 text-ink-soft"></span>
								<span class="text-sm font-semibold text-ink">{s.title}</span>
								<span class="flex-1"></span>
								<span class="i-solar-alt-arrow-right-bold-duotone h-3.5 w-3.5 text-ink-faint"
								></span>
							</div>
							<div class="flex items-baseline gap-1">
								<span class="font-heading text-2xl font-light leading-none text-ink">{s.stat}</span>
								<span class="font-mono text-xs text-ink-mute">{s.unit}</span>
							</div>
							<!-- status-tone progress (mock: --success when done, --warning while incomplete) -->
							<div class="h-1.5 overflow-hidden rounded-full bg-paper-mute">
								<div
									class="h-full {s.done ? 'bg-success' : 'bg-warning'}"
									style="width:{s.pct}%"
								></div>
							</div>
							<span class="font-mono text-xs text-ink-mute">{s.sub}</span>
						</a>
					{/each}
				</div>
			</Card>

			<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<!-- blended cost-per-call trend — aggregate recorded_at + cost_usd -->
				<Card flush>
					<CardHead title="Blended cost / call · 14d">
						{#snippet right()}
							{#if tsum.hasData && tsum.deltaPct !== 0}
								<Chip tone={tsum.deltaPct < 0 ? 'success' : 'warning'}
									>{tsum.deltaPct > 0 ? '+' : ''}{tsum.deltaPct}%</Chip
								>
							{:else}
								<span class="font-mono text-xs text-ink-mute">no trend yet</span>
							{/if}
						{/snippet}
					</CardHead>
					<div class="p-4">
						<div class="mb-3 flex items-baseline gap-1">
							<span class="font-heading text-3xl font-light leading-none text-ink"
								>{tsum.hasData ? '$' + tsum.latest.toFixed(3) : '—'}</span
							>
							<span class="text-sm text-ink-mute">per call</span>
						</div>
						<svg
							viewBox="0 0 200 66"
							class="block w-full"
							style="max-width:260px"
							preserveAspectRatio="xMinYMid meet"
							role="img"
							aria-label="Blended cost per call over the last 14 days"
						>
							{#each sparkBars as b (b.day)}
								<rect
									x={b.x}
									y={b.y}
									width={b.w}
									height={b.h}
									rx="1.5"
									fill="currentColor"
									opacity={b.last ? 1 : 0.6}
									class={b.last ? 'text-accent' : 'text-ink-faint'}
								/>
							{/each}
							<text x="0" y="63" font-size="9" fill="currentColor" class="font-mono text-ink-faint"
								>14d ago</text
							>
							<text
								x="200"
								y="63"
								font-size="9"
								text-anchor="end"
								fill="currentColor"
								class="font-mono text-ink-faint">today</text
							>
						</svg>
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

			<!-- "Jump back in" quick actions (mock's closing section) — real in-app destinations. -->
			<section>
				<h2 class="mb-3 font-heading text-lg font-semibold text-ink">Jump back in</h2>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
					{#each [{ ic: 'i-solar-clipboard-list-bold-duotone', t: 'Inspect recent calls', s: 'live ledger · audit trail', route: '/requests' }, { ic: 'i-solar-key-bold-duotone', t: 'Manage credentials', s: `${connected} of ${providers.length} routers connected`, route: '/connections' }, { ic: 'i-solar-wallet-2-bold-duotone', t: 'Review budgets', s: `${budgetPct}% of the org cap used`, route: '/billing' }] as a (a.route)}
						<a
							href={resolve(a.route)}
							class="flex items-center gap-3 rounded-lg border border-paper-edge bg-paper p-4 transition-colors hover:bg-paper-mute/40"
						>
							<span
								class="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-paper-edge bg-paper-mute"
							>
								<span class="{a.ic} h-[18px] w-[18px] text-ink-soft"></span>
							</span>
							<span class="min-w-0 flex-1">
								<span class="block text-sm font-semibold text-ink">{a.t}</span>
								<span class="mt-0.5 block font-mono text-xs text-ink-mute">{a.s}</span>
							</span>
							<span class="i-solar-alt-arrow-right-bold-duotone h-3.5 w-3.5 text-ink-faint"></span>
						</a>
					{/each}
				</div>
			</section>
		</div>
	{/if}
</AppShell>
