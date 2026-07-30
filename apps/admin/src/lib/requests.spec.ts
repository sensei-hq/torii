import { describe, expect, test } from 'vitest'
import {
	cascadePath,
	csvFilename,
	groupByStatus,
	leafNodes,
	nodePct,
	toCsv,
	triageSummary
} from './requests'
import type { BudgetNode, RequestRow } from './api'

// ── fixtures ─────────────────────────────────────────────────────────────────
const row = (over: Partial<RequestRow> = {}): RequestRow => ({
	id: Math.random().toString(36).slice(2),
	chain_id: 'chat',
	adapter: 'anthropic',
	model: 'claude-sonnet-4-5',
	execution_location: 'cloud',
	input_tokens: 30,
	output_tokens: 24,
	cost_usd: 0.01,
	duration_ms: 500,
	recorded_at: '2026-07-25T10:37:00Z',
	status: 'success',
	...over
})

const node = (over: Partial<BudgetNode> = {}): BudgetNode => ({
	id: 'n',
	parent_id: null,
	kind: 'user',
	name: 'Node',
	cap_amount: 100,
	spent_amount: 10,
	reserved_amount: 0,
	enforcement: 'hard',
	period: 'monthly',
	...over
})

// ── groupByStatus / triage ───────────────────────────────────────────────────
describe('groupByStatus', () => {
	test('counts, sums cost, and computes share-of-all per status', () => {
		const groups = groupByStatus([
			row({ status: 'success', cost_usd: 0.02 }),
			row({ status: 'success', cost_usd: 0.04 }),
			row({ status: 'failed', cost_usd: 0.01 }),
			row({ status: 'failed', cost_usd: 0 })
		])
		const ok = groups.find((g) => g.status === 'success')!
		const bad = groups.find((g) => g.status === 'failed')!
		expect(ok.count).toBe(2)
		expect(ok.cost).toBeCloseTo(0.06)
		expect(ok.pct).toBe(50)
		expect(ok.isException).toBe(false)
		expect(ok.tone).toBe('success')
		expect(bad.count).toBe(2)
		expect(bad.isException).toBe(true)
		expect(bad.tone).toBe('danger')
	})

	test('exceptions sort first, then by descending count — triage, not chronology', () => {
		const groups = groupByStatus([
			...Array.from({ length: 5 }, () => row({ status: 'success' })),
			row({ status: 'failed' }),
			row({ status: 'failed' }),
			row({ status: 'denied' })
		])
		// success is the largest group but must NOT lead — exceptions come first.
		expect(groups[0].isException).toBe(true)
		expect(groups[0].status).toBe('failed') // 2 exceptions > 1 exception
		expect(groups[1].status).toBe('denied')
		expect(groups[groups.length - 1].status).toBe('success')
	})

	test('an unknown status is treated as an exception with a readable label', () => {
		const [g] = groupByStatus([row({ status: 'throttled' })])
		expect(g.isException).toBe(true)
		expect(g.label).toBe('Throttled')
		expect(g.tone).toBe('warning')
	})

	test('empty status is bucketed as "unknown" (never throws)', () => {
		const [g] = groupByStatus([row({ status: '' })])
		expect(g.status).toBe('unknown')
		expect(g.isException).toBe(true)
	})

	test('empty ledger → no groups', () => {
		expect(groupByStatus([])).toEqual([])
	})
})

describe('triageSummary', () => {
	test('exception count/pct/cost are the non-success totals', () => {
		const s = triageSummary(
			groupByStatus([
				row({ status: 'success', cost_usd: 0.5 }),
				row({ status: 'success', cost_usd: 0.5 }),
				row({ status: 'failed', cost_usd: 0.1 }),
				row({ status: 'denied', cost_usd: 0.2 })
			])
		)
		expect(s.total).toBe(4)
		expect(s.exceptions).toBe(2)
		expect(s.exceptionPct).toBe(50)
		expect(s.exceptionCost).toBeCloseTo(0.3)
	})

	test('all-clean ledger → 0 exceptions, no divide-by-zero', () => {
		const s = triageSummary(groupByStatus([row(), row()]))
		expect(s.exceptions).toBe(0)
		expect(s.exceptionPct).toBe(0)
	})

	test('empty ledger → all zero', () => {
		expect(triageSummary([])).toMatchObject({ total: 0, exceptions: 0, exceptionPct: 0 })
	})
})

// ── cascade ──────────────────────────────────────────────────────────────────
describe('cascadePath', () => {
	const tree: BudgetNode[] = [
		node({
			id: 'org',
			parent_id: null,
			kind: 'org',
			name: 'Northwind',
			cap_amount: 1000,
			spent_amount: 300
		}),
		node({
			id: 'dept',
			parent_id: 'org',
			kind: 'dept',
			name: 'Support',
			cap_amount: 400,
			spent_amount: 200
		}),
		node({
			id: 'me',
			parent_id: 'dept',
			kind: 'user',
			name: 'm.okafor',
			cap_amount: 100,
			spent_amount: 90
		})
	]

	test('returns the chain root → target, in order', () => {
		const path = cascadePath(tree, 'me')
		expect(path.map((n) => n.id)).toEqual(['org', 'dept', 'me'])
	})

	test('a missing target yields an empty path (never throws)', () => {
		expect(cascadePath(tree, 'ghost')).toEqual([])
	})

	test('a self-referential cycle terminates instead of looping forever', () => {
		const cyclic: BudgetNode[] = [
			node({ id: 'a', parent_id: 'b' }),
			node({ id: 'b', parent_id: 'a' })
		]
		const path = cascadePath(cyclic, 'a')
		expect(path.length).toBe(2)
		expect(new Set(path.map((n) => n.id)).size).toBe(2)
	})
})

describe('leafNodes', () => {
	test('returns only childless nodes, tightest utilization first', () => {
		const tree: BudgetNode[] = [
			node({ id: 'org', parent_id: null, cap_amount: 1000, spent_amount: 100 }),
			node({ id: 'dept', parent_id: 'org', cap_amount: 400, spent_amount: 100 }),
			node({ id: 'me', parent_id: 'dept', cap_amount: 100, spent_amount: 90 }), // 90%
			node({ id: 'peer', parent_id: 'dept', cap_amount: 100, spent_amount: 20 }) // 20%
		]
		const leaves = leafNodes(tree)
		expect(leaves.map((n) => n.id)).toEqual(['me', 'peer']) // org/dept are parents
	})
})

describe('nodePct', () => {
	test('spent/cap as a whole percent; an uncapped node reads 0', () => {
		expect(nodePct(node({ cap_amount: 200, spent_amount: 50 }))).toBe(25)
		expect(nodePct(node({ cap_amount: null, spent_amount: 50 }))).toBe(0)
	})
})

// ── CSV ──────────────────────────────────────────────────────────────────────
describe('toCsv', () => {
	test('emits a header row plus one line per request', () => {
		const csv = toCsv([row(), row()])
		const lines = csv.split('\r\n')
		expect(lines).toHaveLength(3)
		expect(lines[0]).toBe(
			'Time,Model,Adapter,Chain,Plane,Input tokens,Output tokens,Cost USD,Duration ms,Status,ID'
		)
	})

	test('quotes/escapes cells containing commas, quotes, or newlines (no column bleed)', () => {
		const csv = toCsv([row({ model: 'a,b', chain_id: 'say "hi"', status: 'line1\nline2' })])
		const line = csv.split('\r\n')[1]
		expect(line).toContain('"a,b"')
		expect(line).toContain('"say ""hi"""')
		expect(line).toContain('"line1\nline2"')
	})

	test('null cells render empty, not the string "null"', () => {
		const csv = toCsv([row({ chain_id: null, execution_location: null, input_tokens: null })])
		expect(csv).not.toContain('null')
	})

	test('cost is exported as the raw number (machine-readable, not "$")', () => {
		const csv = toCsv([row({ cost_usd: 0.0123 })])
		expect(csv).toContain('0.0123')
		expect(csv).not.toContain('$')
	})

	test('empty ledger still yields the header row alone', () => {
		expect(toCsv([])).toBe(
			'Time,Model,Adapter,Chain,Plane,Input tokens,Output tokens,Cost USD,Duration ms,Status,ID'
		)
	})
})

test('csvFilename is dated and .csv', () => {
	expect(csvFilename(new Date('2026-07-30T12:00:00Z'))).toBe('requests-2026-07-30.csv')
})
