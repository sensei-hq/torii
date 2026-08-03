<script>
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { PageHeader, Card, CardHead, Meter, Chip, Empty } from '@torii/ui'
	import { session } from '@torii/core'
	import { api } from '$lib/api'
	import { home } from '$lib/home.svelte'
	import { QUICK_ACTIONS } from '$lib/home'

	/** @type {import('$lib/api').RequestRow[]} */
	let requests = $state([])
	/** @type {import('$lib/api').BudgetNode[]} */
	let nodes = $state([])
	let loading = $state(true)

	onMount(async () => {
		// The Home store drives its own loading state for the models list + banner.
		home.load()
		try {
			const [r, b] = await Promise.all([api.requests(6), api.budgets()])
			requests = r.requests
			nodes = b.nodes
		} catch {
			// member may lack read caps — the landing still renders with the CTA.
		} finally {
			loading = false
		}
	})

	const name = $derived(session.user?.name ?? 'there')
	const ceiling = $derived(nodes.find((n) => n.kind === 'org') ?? nodes[0])
	// "Models you can use" + the offline/degraded banner, both derived from the real reads.
	const models = $derived(home.models)
	const health = $derived(home.health)
	/** @param {number | null} n */
	const money = (n) => (n == null ? '∞' : '$' + Number(n).toFixed(2))
	/** @param {string} s */
	const fmtTime = (s) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	/** @param {number} c */
	const fmtCost = (c) => (c === 0 ? '$0' : '$' + Number(c).toFixed(4))
	/** @param {string} route */
	const jump = (route) => goto(resolve(route))
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow={new Date().toLocaleDateString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		})}
		title={`Welcome back, ${name}.`}
		sub="One endpoint for every model — the gateway auto-routes the best model under your budget and always shows you where each answer ran."
	/>

	<!-- offline / degraded banner — driven by the embedded gateway_status + cloud reachability -->
	{#if health.show}
		<div
			data-gateway-banner
			role="status"
			class="mx-5 mb-4 flex items-start gap-3 rounded-lg border border-paper-edge px-4 py-3 {health.tone ===
			'degraded'
				? 'bg-warning-soft'
				: 'bg-paper-mute'}"
		>
			<span
				class="mt-0.5 h-4 w-4 flex-shrink-0 {health.tone === 'degraded'
					? 'i-solar-danger-triangle-bold-duotone text-warning'
					: 'i-solar-cloud-cross-bold-duotone text-ink-mute'}"
			></span>
			<div class="min-w-0">
				<div class="text-sm font-semibold text-ink">{health.headline}</div>
				<div class="text-[13px] text-ink-soft">{health.detail}</div>
			</div>
		</div>
	{/if}

	<div class="space-y-4 px-5 pb-6">
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<!-- your lane: budget ceiling -->
			<Card flush>
				<CardHead title="Your lane" meta={ceiling ? ceiling.name : ''} />
				<div class="p-4">
					{#if ceiling}
						<Meter
							value={ceiling.spent_amount}
							max={ceiling.cap_amount ?? Math.max(ceiling.spent_amount, 1)}
							tone={ceiling.cap_amount && ceiling.spent_amount / ceiling.cap_amount >= 0.9
								? 'danger'
								: 'accent'}
							display={`${money(ceiling.spent_amount)} / ${money(ceiling.cap_amount)}`}
						/>
						<p class="mt-3 text-[13px] text-ink-mute">
							The gateway routes the best model under this ceiling — step-downs and a free-tier
							floor keep spend in check, and every answer shows where it ran.
						</p>
					{:else}
						<p class="text-sm text-ink-mute">
							Budget shows here once your workspace is set up. Ask away — local answers are free.
						</p>
					{/if}
					<button
						onclick={() => jump('/ask')}
						class="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary"
					>
						<span class="i-solar-chat-round-line-bold-duotone h-4 w-4"></span> Ask something
					</button>
				</div>
			</Card>

			<!-- models you can use (from /v1/models/available) -->
			<Card flush>
				<CardHead
					title="Models you can use"
					meta={models.length ? `${models.length} available` : ''}
				/>
				<div>
					{#if home.loading && !home.loaded}
						<p class="px-4 py-3 text-sm text-ink-mute">Loading…</p>
					{:else if models.length === 0}
						<Empty
							icon="i-solar-server-minimalistic-bold-duotone"
							message="No models available yet"
							hint="Once a router is connected and reachable, the models you can call show here."
							pad="py-6"
						/>
					{:else}
						{#each models as m (m.id)}
							<div
								class="flex items-center gap-3 border-b border-paper-edge px-4 py-2.5 last:border-b-0"
							>
								<span
									class="h-4 w-4 flex-shrink-0 text-ink-mute {m.plane === 'local'
										? 'i-solar-cpu-bold-duotone'
										: 'i-solar-server-minimalistic-bold-duotone'}"
								></span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm text-ink">{m.name}</span>
									<span class="block truncate font-mono text-[11px] text-ink-mute">{m.id}</span>
								</span>
								<Chip tone={m.plane === 'local' ? 'success' : 'accent'}
									>{m.plane === 'local' ? 'on device' : m.provider || 'cloud'}</Chip
								>
							</div>
						{/each}
					{/if}
				</div>
			</Card>
		</div>

		<!-- pick up where you left off -->
		<Card flush>
			<CardHead title="Recent" meta="your activity" />
			<div>
				{#if loading}
					<p class="px-4 py-3 text-sm text-ink-mute">Loading…</p>
				{:else if requests.length === 0}
					<p class="px-4 py-3 text-sm text-ink-mute">
						Nothing yet — your requests will appear here.
					</p>
				{:else}
					{#each requests as r (r.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-2.5 last:border-b-0"
						>
							<span class="w-12 font-mono text-[11px] text-ink-mute">{fmtTime(r.recorded_at)}</span>
							<span class="flex-1 truncate text-sm text-ink">{r.model}</span>
							<Chip tone={r.execution_location === 'local' ? 'success' : 'mute'}
								>{r.execution_location ?? '—'}</Chip
							>
							<span class="font-mono text-[11px] text-ink-mute">{fmtCost(r.cost_usd)}</span>
						</div>
					{/each}
				{/if}
			</div>
		</Card>

		<!-- start something new: quick-action tiles -->
		<div>
			<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-mute">
				Start something new
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{#each QUICK_ACTIONS as a (a.key)}
					<button
						onclick={() => jump(a.route)}
						class="flex items-center gap-3 rounded-lg border border-paper-edge bg-paper-soft p-4 text-left hover:border-ink-mute"
					>
						<span class="grid h-10 w-10 flex-shrink-0 place-items-center rounded-md bg-paper-mute">
							<span class="{a.icon} h-5 w-5 text-ink-soft"></span>
						</span>
						<span class="min-w-0 flex-1">
							<span class="block text-sm font-semibold text-ink">{a.title}</span>
							<span class="block truncate font-mono text-[11px] text-ink-mute">{a.sub}</span>
						</span>
						<span class="i-solar-arrow-right-linear h-4 w-4 flex-shrink-0 text-ink-faint"></span>
					</button>
				{/each}
			</div>
		</div>
	</div>
</section>
