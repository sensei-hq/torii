// Pure, client-side derivations for the Overview daily-briefing dashboard. Kept out of
// the component so they're unit-testable (type-only imports → no $env at runtime). Every
// figure is computed from the real gateway reads (/v1/requests, /v1/budgets,
// /v1/connections, /v1/models, /v1/routing) — no mock data.
import type { BudgetNode, ModelRow, Provider, RequestRow, RoutingStep } from './api'

/** `$X.YY` money, resilient to non-finite inputs. */
export function money(n: number): string {
	return '$' + (Number.isFinite(n) ? n : 0).toFixed(2)
}

// ── execution plane: on-device (local) vs via-gateway (cloud) ────────────────
export interface ExecPlaneSplit {
	/** calls that ran on the local plane (`execution_location === 'local'`). */
	local: number
	/** calls that ran via the gateway (any non-null, non-local location). */
	cloud: number
	/** calls whose plane the ledger did not record (null location). */
	unknown: number
	total: number
	/** share of ALL calls, 0-100 rounded. */
	localPct: number
	cloudPct: number
	/** $ spent on local calls (≈ $0 egress) and via the gateway, respectively. */
	localCost: number
	cloudCost: number
}

const isLocal = (r: RequestRow) => r.execution_location === 'local'
const isCloud = (r: RequestRow) => r.execution_location != null && r.execution_location !== 'local'

export function execPlaneSplit(requests: RequestRow[]): ExecPlaneSplit {
	const total = requests.length
	let local = 0
	let cloud = 0
	let unknown = 0
	let localCost = 0
	let cloudCost = 0
	for (const r of requests) {
		const c = Number(r.cost_usd || 0)
		if (isLocal(r)) {
			local++
			localCost += c
		} else if (isCloud(r)) {
			cloud++
			cloudCost += c
		} else {
			unknown++
		}
	}
	const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
	return {
		local,
		cloud,
		unknown,
		total,
		localPct: pct(local),
		cloudPct: pct(cloud),
		localCost,
		cloudCost
	}
}

// ── blended cost-per-call trend (for the sparkline) ──────────────────────────
export interface TrendPoint {
	/** UTC calendar day, `YYYY-MM-DD`. */
	day: string
	/** total $ spent that day. */
	cost: number
	/** calls recorded that day. */
	calls: number
	/** blended $/call that day (0 when the day had no calls). */
	costPerCall: number
}

const MS_PER_DAY = 86_400_000
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * Blended cost-per-call, one point per day, over a trailing `days`-day window that ends
 * on the most recent request (or `now` when the ledger is empty). Missing days are
 * 0-filled so the sparkline is a continuous fixed-width series, oldest → newest. The
 * window is anchored at the latest activity (not wall-clock now) so sparse dev/live
 * data still charts instead of collapsing to an empty run of days.
 */
export function costTrend(requests: RequestRow[], days = 14, now: Date = new Date()): TrendPoint[] {
	const buckets = new Map<string, { cost: number; calls: number }>()
	let anchorMs = now.getTime()
	let sawActivity = false
	for (const r of requests) {
		const t = new Date(r.recorded_at).getTime()
		if (Number.isNaN(t)) continue
		if (!sawActivity || t > anchorMs) {
			anchorMs = t
			sawActivity = true
		}
		const key = utcDay(t)
		const b = buckets.get(key) ?? { cost: 0, calls: 0 }
		b.cost += Number(r.cost_usd || 0)
		b.calls += 1
		buckets.set(key, b)
	}
	// normalise the anchor to UTC midnight so the window is whole calendar days.
	const anchor = new Date(anchorMs)
	const baseMs = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())
	const out: TrendPoint[] = []
	for (let i = days - 1; i >= 0; i--) {
		const key = utcDay(baseMs - i * MS_PER_DAY)
		const b = buckets.get(key) ?? { cost: 0, calls: 0 }
		out.push({
			day: key,
			cost: b.cost,
			calls: b.calls,
			costPerCall: b.calls ? b.cost / b.calls : 0
		})
	}
	return out
}

export interface TrendSummary {
	/** blended $/call on the most recent day that had calls. */
	latest: number
	/** blended $/call on the earliest day (in-window) that had calls. */
	earliest: number
	/** signed % change latest-vs-earliest (negative = trending cheaper). */
	deltaPct: number
	/** false when no day in the window recorded a call. */
	hasData: boolean
}

export function trendSummary(points: TrendPoint[]): TrendSummary {
	const withCalls = points.filter((p) => p.calls > 0)
	if (withCalls.length === 0) return { latest: 0, earliest: 0, deltaPct: 0, hasData: false }
	const latest = withCalls[withCalls.length - 1].costPerCall
	const earliest = withCalls[0].costPerCall
	const deltaPct = earliest ? Math.round(((latest - earliest) / earliest) * 100) : 0
	return { latest, earliest, deltaPct, hasData: true }
}

// ── setup spine: connect → register → route, with real coverage ──────────────
export interface SetupStep {
	key: 'connect' | 'register' | 'route'
	title: string
	/** i-solar-* icon utility class. */
	icon: string
	/** in-app route this card deep-links to. */
	route: string
	stat: number
	unit: string
	/** completion, 0-100 rounded. */
	pct: number
	/** the step is fully satisfied. */
	done: boolean
	sub: string
}

/** A router is "connected" when it needs no key (local) or the tenant sealed a credential. */
const routerConnected = (p: Provider) => !p.requires_key || p.connected || p.oauth_connected

export function setupSpine(
	providers: Provider[],
	models: ModelRow[],
	routing: RoutingStep[]
): SetupStep[] {
	// 1 · connect routers
	const connected = providers.filter(routerConnected).length
	const needKey = providers.filter(
		(p) => p.requires_key && !p.connected && !p.oauth_connected
	).length
	const connPct = providers.length ? Math.round((connected / providers.length) * 100) : 0

	// 2 · register models — reachable in the tenant catalog; local = a keyless router.
	const localRouters = new Set(providers.filter((p) => !p.requires_key).map((p) => p.name))
	const reachable = models.filter((m) => m.reachable)
	const onDevice = reachable.filter((m) => localRouters.has(m.provider)).length
	const viaGateway = Math.max(0, reachable.length - onDevice)
	const modelPct = models.length ? Math.round((reachable.length / models.length) * 100) : 0

	// 3 · route & fall back — active fallback steps across distinct chains.
	const active = routing.filter((s) => s.is_active).length
	const chains = new Set(routing.map((s) => s.chain_name)).size
	const routePct = routing.length ? Math.round((active / routing.length) * 100) : 0

	return [
		{
			key: 'connect',
			title: 'Connect routers',
			icon: 'i-solar-key-bold-duotone',
			route: '/connections',
			stat: connected,
			unit: `/ ${providers.length} routers`,
			pct: connPct,
			done: providers.length > 0 && needKey === 0,
			sub: needKey ? `${needKey} need a key` : providers.length ? 'all routers reachable' : 'no routers yet'
		},
		{
			key: 'register',
			title: 'Register models',
			icon: 'i-solar-layers-minimalistic-bold-duotone',
			route: '/models',
			stat: reachable.length,
			unit: `/ ${models.length} reachable`,
			pct: modelPct,
			done: models.length > 0 && reachable.length === models.length,
			sub: models.length ? `${onDevice} on-device · ${viaGateway} via gateway` : 'no models yet'
		},
		{
			key: 'route',
			title: 'Route & fall back',
			icon: 'i-solar-routing-2-bold-duotone',
			route: '/routing',
			stat: active,
			unit: 'steps live',
			pct: routePct,
			done: active > 0,
			sub: chains ? `${chains} chain${chains === 1 ? '' : 's'} configured` : 'no chains yet'
		}
	]
}

// ── hero insight: the single most salient fact today ─────────────────────────
export interface HeroInsight {
	tone: 'accent' | 'danger' | 'ink'
	icon: string
	/** the headline reads `{lead} <b>{figure}</b> {trail}`. */
	lead: string
	figure: string
	trail: string
	detail: string
	actionLabel: string
	actionRoute: string
}

export interface HeroInput {
	requests: RequestRow[]
	plane: ExecPlaneSplit
	spend: number
	orgRoot?: BudgetNode
	budgetPct: number
	setup: SetupStep[]
}

/**
 * Pick the single insight worth leading with, by urgency:
 *   1. budget pressure (>= 90% of a hard cap) — the thing that will start refusing calls,
 *   2. incomplete setup with no traffic yet — guide the operator to first value,
 *   3. on-device savings — celebrate the local plane when it carried real load,
 *   4. otherwise a plain spend summary.
 */
export function heroInsight({
	requests,
	plane,
	spend,
	orgRoot,
	budgetPct,
	setup
}: HeroInput): HeroInsight {
	if (orgRoot && orgRoot.cap_amount != null && budgetPct >= 90) {
		return {
			tone: 'danger',
			icon: 'i-solar-wallet-2-bold-duotone',
			lead: `${orgRoot.name} has used`,
			figure: `${budgetPct}%`,
			trail: 'of its budget cap.',
			detail: `${money(orgRoot.spent_amount)} of ${money(orgRoot.cap_amount)} spent — raise the cap or tighten routing before calls start getting refused.`,
			actionLabel: 'Review budgets',
			actionRoute: '/organization'
		}
	}

	const incomplete = setup.filter((s) => !s.done)
	if (requests.length === 0 && incomplete.length > 0) {
		const next = incomplete[0]
		return {
			tone: 'accent',
			icon: 'i-solar-plug-circle-bold-duotone',
			lead: 'Finish setup —',
			figure: next.title.toLowerCase(),
			trail: 'to route your first call.',
			detail: `${next.sub}. Connect a router, register its models, then route — coverage confirms every model resolves end-to-end.`,
			actionLabel: next.title,
			actionRoute: next.route
		}
	}

	if (plane.local > 0) {
		return {
			tone: 'accent',
			icon: 'i-solar-server-bold-duotone',
			lead: 'On-device inference handled',
			figure: `${plane.localPct}%`,
			trail: 'of calls this window.',
			detail: `${plane.local.toLocaleString()} of ${plane.total.toLocaleString()} calls ran on the local plane at $0 egress — the rest cost ${money(plane.cloudCost)} via the gateway.`,
			actionLabel: 'See routing',
			actionRoute: '/routing'
		}
	}

	return {
		tone: 'ink',
		icon: 'i-solar-global-bold-duotone',
		lead: 'The gateway served',
		figure: `${requests.length.toLocaleString()} calls`,
		trail: `for ${money(spend)} this window.`,
		detail: requests.length
			? `That's ${money(spend / requests.length)} per call — inspect the ledger to see where the spend is going.`
			: 'No calls recorded yet — traffic will appear here as it flows through the gateway.',
		actionLabel: 'Inspect requests',
		actionRoute: '/requests'
	}
}
