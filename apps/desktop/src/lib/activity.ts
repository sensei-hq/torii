// Pure, client-side derivations for the Torii Activity ("You") screen. Kept out of the
// component (and out of the .svelte.ts store) so they're unit-testable in a node env —
// type-only imports mean no $env/Tauri is pulled in at runtime (mirrors src/lib/home.ts).
// Every value here is derived from the REAL gateway reads: /v1/requests (the member's
// interaction ledger) and /v1/budgets (their ceiling + the org→…→you cascade). No mock data.
import type { BudgetNode, RequestRow } from './api'

/** Format a number as USD with 2 decimals; a non-finite input degrades to `$0.00`. */
export function money(n: number): string {
	return '$' + (Number.isFinite(n) ? n : 0).toFixed(2)
}

// ── member budget cascade: walk the org → dept → team → user tree ─────────────
/** Utilization of a node as a whole percent (0 when it carries no cap — uncapped ≠ 100%). */
export function nodePct(n: BudgetNode): number {
	return n.cap_amount ? Math.round((n.spent_amount / n.cap_amount) * 100) : 0
}

/**
 * The chain of caps a leaf inherits from: walk `parent_id` up from `targetId` to the root,
 * then return it root → target so the view renders top-down (org → dept → you). Cycle-safe
 * (a malformed self-referential tree can't loop) and returns `[]` when the target is absent.
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
 * The leaf nodes of the budget tree (no children) — the members/teams whose ceilings are
 * carved from a parent. Tightest utilization first, so the ceiling closest to refusing calls
 * (the one most likely to need an increase) surfaces at the top of the picker.
 */
export function leafNodes(nodes: BudgetNode[]): BudgetNode[] {
	const parents = new Set(nodes.map((n) => n.parent_id).filter((p): p is string => p != null))
	return nodes.filter((n) => !parents.has(n.id)).sort((a, b) => nodePct(b) - nodePct(a))
}

// ── filter predicate for the activity ledger ─────────────────────────────────
/**
 * Does an inference row match the search needle (already trimmed + lowercased) and the plane
 * filter? `plane` is 'all' | 'cloud' | 'local'; a null `execution_location` only matches
 * 'all'. An empty needle matches everything (subject to the plane).
 */
export function matchesRequest(r: RequestRow, needle: string, plane: string): boolean {
	if (plane !== 'all' && (r.execution_location ?? '') !== plane) return false
	if (!needle) return true
	return `${r.model} ${r.adapter} ${r.status} ${r.execution_location ?? ''}`
		.toLowerCase()
		.includes(needle)
}

// ── CSV export of the (filtered) activity table ──────────────────────────────
const CSV_COLUMNS: { key: keyof RequestRow; header: string }[] = [
	{ key: 'recorded_at', header: 'Time' },
	{ key: 'model', header: 'Model' },
	{ key: 'adapter', header: 'Adapter' },
	{ key: 'execution_location', header: 'Plane' },
	{ key: 'input_tokens', header: 'Input tokens' },
	{ key: 'output_tokens', header: 'Output tokens' },
	{ key: 'cost_usd', header: 'Cost USD' },
	{ key: 'duration_ms', header: 'Duration ms' },
	{ key: 'status', header: 'Status' },
	{ key: 'id', header: 'ID' }
]

/**
 * RFC-4180 cell: quote when the value contains a comma, quote, or newline; double any
 * embedded quote. Null/undefined render as an empty cell (never the string "null").
 */
function csvCell(v: unknown): string {
	if (v == null) return ''
	const s = String(v)
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize the given rows to CSV (header + one line per row, CRLF-joined per RFC-4180). */
export function toCsv(requests: RequestRow[]): string {
	const head = CSV_COLUMNS.map((c) => c.header).join(',')
	const lines = requests.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(','))
	return [head, ...lines].join('\r\n')
}

/** A dated, filesystem-safe filename for the export (e.g. `activity-2026-07-30.csv`). */
export function csvFilename(now: Date = new Date()): string {
	return `activity-${now.toISOString().slice(0, 10)}.csv`
}
