// Pure, client-side derivations for the Requests & audit screen. Kept out of the
// component so they're unit-testable (type-only imports → no $env at runtime). Every
// figure is computed from the real gateway reads (/v1/requests, /v1/budgets) — no mock
// data. Three concerns: exception triage (group the ledger by outcome status), the
// member budget cascade (walk the budget tree), and CSV export of the request table.
import type { BudgetNode, RequestRow } from './api'
import { money } from './overview'

export { money }

// ── exception triage: group the ledger by outcome status ─────────────────────
export type Tone = 'success' | 'warning' | 'danger' | 'mute'

export interface StatusGroup {
	/** the raw `inference_calls.status` (lower-cased). */
	status: string
	/** human label for the group header. */
	label: string
	count: number
	/** total $ spent by rows in this group. */
	cost: number
	/** share of ALL rows, 0-100 rounded. */
	pct: number
	tone: Tone
	/** anything but a clean success is an exception worth triaging. */
	isException: boolean
}

// Known statuses get a stable label/tone; the ledger CHECK today is success|failed, but
// the grouping is resilient to any string the ledger may carry (denied/error/…).
const STATUS_META: Record<string, { label: string; tone: Tone; exception: boolean }> = {
	success: { label: 'Served', tone: 'success', exception: false },
	failed: { label: 'Failed', tone: 'danger', exception: true },
	error: { label: 'Error', tone: 'danger', exception: true },
	denied: { label: 'Denied', tone: 'warning', exception: true }
}

/** Title-case an unknown status slug for a readable group header. */
function humanize(s: string): string {
	if (!s) return 'Unknown'
	return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Group the request ledger by outcome status for triage. Exceptions (anything but a
 * clean `success`) sort first, then by descending count, then status name — so the
 * rows worth a look surface at the top regardless of volume.
 */
export function groupByStatus(requests: RequestRow[]): StatusGroup[] {
	const total = requests.length
	const acc = new Map<string, { count: number; cost: number }>()
	for (const r of requests) {
		const key = (r.status || 'unknown').toLowerCase()
		const b = acc.get(key) ?? { count: 0, cost: 0 }
		b.count += 1
		b.cost += Number(r.cost_usd || 0)
		acc.set(key, b)
	}
	const groups = [...acc.entries()].map(([status, b]): StatusGroup => {
		const meta = STATUS_META[status]
		return {
			status,
			label: meta?.label ?? humanize(status),
			count: b.count,
			cost: b.cost,
			pct: total ? Math.round((b.count / total) * 100) : 0,
			tone: meta?.tone ?? 'warning',
			isException: meta ? meta.exception : status !== 'success'
		}
	})
	groups.sort(
		(a, b) =>
			Number(b.isException) - Number(a.isException) ||
			b.count - a.count ||
			a.status.localeCompare(b.status)
	)
	return groups
}

export interface TriageSummary {
	total: number
	/** rows whose status is not a clean success. */
	exceptions: number
	/** exception share of all rows, 0-100 rounded. */
	exceptionPct: number
	/** $ tied up in exception rows. */
	exceptionCost: number
}

export function triageSummary(groups: StatusGroup[]): TriageSummary {
	let total = 0
	let exceptions = 0
	let exceptionCost = 0
	for (const g of groups) {
		total += g.count
		if (g.isException) {
			exceptions += g.count
			exceptionCost += g.cost
		}
	}
	return {
		total,
		exceptions,
		exceptionPct: total ? Math.round((exceptions / total) * 100) : 0,
		exceptionCost
	}
}

// ── org operational lens: "usage patterns" (the admin Requests header + meters) ─
// The mock's admin Requests is an operational lens, not a ledger: how many calls, how
// much they cost, and which models carry the traffic. Every figure below is REAL, from
// /v1/requests. The fallback/step-down/failover breakdown the mock also shows needs the
// per-call routing-trace column (GH-5, backend pass) — surfaced honestly as null here.

const MS_PER_HOUR = 3_600_000

/** Calls recorded within the trailing `hours`-hour window ending at `now`. */
export function callsInWindow(requests: RequestRow[], hours = 24, now: Date = new Date()): number {
	const cutoff = now.getTime() - hours * MS_PER_HOUR
	let n = 0
	for (const r of requests) {
		const t = new Date(r.recorded_at).getTime()
		if (Number.isFinite(t) && t >= cutoff) n++
	}
	return n
}

/** Mean $/call over the given rows (0 when none) — the "Avg cost" tile. */
export function avgCost(requests: RequestRow[]): number {
	if (!requests.length) return 0
	return requests.reduce((s, r) => s + Number(r.cost_usd || 0), 0) / requests.length
}

export interface ModelUsage {
	model: string
	/** the router/adapter that served it — a subtle provenance label. */
	adapter: string
	calls: number
	/** share of ALL calls, 0-100 rounded. */
	share: number
}

/**
 * Which models actually carried traffic, busiest first — the "what's being used" meters.
 * Groups the ledger by model, counts calls, and computes each model's share of the whole.
 * `limit` caps the list to the top-N busiest so the card stays a glance, not a table.
 */
export function usageByModel(requests: RequestRow[], limit = 8): ModelUsage[] {
	const total = requests.length
	const acc = new Map<string, { adapter: string; calls: number }>()
	for (const r of requests) {
		const model = r.model || 'unknown'
		const b = acc.get(model) ?? { adapter: r.adapter || '', calls: 0 }
		b.calls += 1
		acc.set(model, b)
	}
	return [...acc.entries()]
		.map(([model, b]): ModelUsage => ({
			model,
			adapter: b.adapter,
			calls: b.calls,
			share: total ? Math.round((b.calls / total) * 100) : 0
		}))
		.sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model))
		.slice(0, limit)
}

export interface UsageStats {
	/** calls in the trailing 24h — REAL. */
	calls24h: number
	/** mean $/call over the window — REAL. */
	avgCost: number
	/**
	 * Fallback-rate / step-down / failover counts classify *why* a call fell back, which
	 * needs the per-call routing trace (GH-5). Today the ledger's `status` is only
	 * success|failed — it can't distinguish a budget step-down from a provider failover —
	 * so these stay `null` (rendered "—") until the trace column lands, rather than faked.
	 */
	fallbackRate: number | null
	stepDowns: number | null
	failovers: number | null
}

/** The five header tiles: two computed from real reads, three deferred to the trace backend. */
export function usageStats(requests: RequestRow[], now: Date = new Date()): UsageStats {
	return {
		calls24h: callsInWindow(requests, 24, now),
		avgCost: avgCost(requests),
		fallbackRate: null,
		stepDowns: null,
		failovers: null
	}
}

// ── member budget cascade: walk the org → dept → team → user tree ─────────────
/** Utilization of a node as a whole percent (0 when it carries no cap). */
export function nodePct(n: BudgetNode): number {
	return n.cap_amount ? Math.round((n.spent_amount / n.cap_amount) * 100) : 0
}

/**
 * The chain of caps a leaf inherits from: walk `parent_id` up from `targetId` to the
 * root, then return it root → target so the view renders top-down (org → dept → you).
 * Cycle-safe (a malformed self-referential tree can't loop) and returns `[]` when the
 * target is absent.
 */
export function cascadePath(nodes: BudgetNode[], targetId: string): BudgetNode[] {
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const path: BudgetNode[] = []
	const seen = new Set<string>()
	let cur = byId.get(targetId)
	while (cur && !seen.has(cur.id)) {
		seen.add(cur.id)
		path.push(cur)
		cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
	}
	return path.reverse()
}

/**
 * The leaf nodes of the budget tree (no children) — the members/teams whose ceilings
 * are carved from a parent. Tightest utilization first, so the ceilings closest to
 * refusing calls surface at the top of the picker.
 */
export function leafNodes(nodes: BudgetNode[]): BudgetNode[] {
	const parents = new Set(nodes.map((n) => n.parent_id).filter((p): p is string => p != null))
	return nodes.filter((n) => !parents.has(n.id)).sort((a, b) => nodePct(b) - nodePct(a))
}

// ── CSV export of the (filtered) request table ───────────────────────────────
const CSV_COLUMNS: { key: keyof RequestRow; header: string }[] = [
	{ key: 'recorded_at', header: 'Time' },
	{ key: 'model', header: 'Model' },
	{ key: 'adapter', header: 'Adapter' },
	{ key: 'chain_id', header: 'Chain' },
	{ key: 'execution_location', header: 'Plane' },
	{ key: 'input_tokens', header: 'Input tokens' },
	{ key: 'output_tokens', header: 'Output tokens' },
	{ key: 'cost_usd', header: 'Cost USD' },
	{ key: 'duration_ms', header: 'Duration ms' },
	{ key: 'status', header: 'Status' },
	{ key: 'id', header: 'ID' }
]

/** RFC-4180 cell: quote when the value contains a comma, quote, or newline; double
 *  any embedded quote. Null/undefined render as an empty cell. */
function csvCell(v: unknown): string {
	if (v == null) return ''
	const s = String(v)
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize the given request rows to CSV (header + one line per row, CRLF-joined). */
export function toCsv(requests: RequestRow[]): string {
	const head = CSV_COLUMNS.map((c) => c.header).join(',')
	const lines = requests.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(','))
	return [head, ...lines].join('\r\n')
}

/** A dated, filesystem-safe filename for the export. */
export function csvFilename(now: Date = new Date()): string {
	return `requests-${now.toISOString().slice(0, 10)}.csv`
}
