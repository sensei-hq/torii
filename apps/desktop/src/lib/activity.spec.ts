import { describe, expect, test } from 'vitest'
import {
	cascadePath,
	csvFilename,
	leafNodes,
	matchesRequest,
	money,
	nodePct,
	toCsv
} from './activity'
import type { BudgetNode, RequestRow } from './api'

// ── fixtures ─────────────────────────────────────────────────────────────────
const node = (over: Partial<BudgetNode> = {}): BudgetNode => ({
	id: 'n',
	parent_id: null,
	kind: 'user',
	name: 'Node',
	cap_amount: 400,
	spent_amount: 100,
	reserved_amount: 0,
	enforcement: 'hard',
	period: 'monthly',
	...over
})

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
	id: 'r1',
	chain_id: null,
	adapter: 'anthropic',
	model: 'claude-sonnet-4-5',
	execution_location: 'cloud',
	input_tokens: 100,
	output_tokens: 200,
	cost_usd: 0.0123,
	duration_ms: 1200,
	status: 'success',
	recorded_at: '2026-07-30T09:42:00.000Z',
	...over
})

// ── money ────────────────────────────────────────────────────────────────────
describe('money', () => {
	test('formats as USD with 2 decimals; non-finite degrades to $0.00', () => {
		expect(money(250)).toBe('$250.00')
		expect(money(0)).toBe('$0.00')
		expect(money(1.5)).toBe('$1.50')
		expect(money(NaN)).toBe('$0.00')
		expect(money(Infinity)).toBe('$0.00')
	})
})

// ── nodePct ──────────────────────────────────────────────────────────────────
describe('nodePct', () => {
	test('utilization as a whole percent of the cap', () => {
		expect(nodePct(node({ spent_amount: 100, cap_amount: 400 }))).toBe(25)
		expect(nodePct(node({ spent_amount: 400, cap_amount: 400 }))).toBe(100)
	})

	test('an uncapped node is 0%, never treated as full (guards a /0)', () => {
		expect(nodePct(node({ cap_amount: null, spent_amount: 999 }))).toBe(0)
	})
})

// ── cascadePath ──────────────────────────────────────────────────────────────
describe('cascadePath', () => {
	const org = node({ id: 'org', parent_id: null, kind: 'org', name: 'Acme' })
	const dept = node({ id: 'dept', parent_id: 'org', kind: 'team', name: 'Support' })
	const me = node({ id: 'me', parent_id: 'dept', kind: 'user', name: 'You' })
	const tree = [me, org, dept] // deliberately unordered — order must not matter

	test('walks parent_id up and returns the chain root → target (top-down render order)', () => {
		expect(cascadePath(tree, 'me').map((n) => n.id)).toEqual(['org', 'dept', 'me'])
	})

	test('an absent target yields an empty path (no throw)', () => {
		expect(cascadePath(tree, 'ghost')).toEqual([])
	})

	test('a self-referential / cyclic tree terminates instead of looping forever', () => {
		const a = node({ id: 'a', parent_id: 'b' })
		const b = node({ id: 'b', parent_id: 'a' })
		const path = cascadePath([a, b], 'a')
		// the CONTRACT: it must return (cycle-safe), covering each node at most once.
		expect(new Set(path.map((n) => n.id)).size).toBe(path.length)
		expect(path.length).toBeLessThanOrEqual(2)
	})
})

// ── leafNodes ────────────────────────────────────────────────────────────────
describe('leafNodes', () => {
	test('returns only nodes with no children (the members/teams that can request more)', () => {
		const org = node({ id: 'org', parent_id: null })
		const dept = node({ id: 'dept', parent_id: 'org' })
		const leaf = node({ id: 'leaf', parent_id: 'dept' })
		const ids = leafNodes([org, dept, leaf]).map((n) => n.id)
		expect(ids).toEqual(['leaf'])
	})

	test('orders tightest-utilization first — the ceiling closest to refusing calls leads', () => {
		const a = node({ id: 'a', parent_id: null, spent_amount: 50, cap_amount: 100 }) // 50%
		const b = node({ id: 'b', parent_id: null, spent_amount: 90, cap_amount: 100 }) // 90%
		const c = node({ id: 'c', parent_id: null, spent_amount: 10, cap_amount: 100 }) // 10%
		expect(leafNodes([a, b, c]).map((n) => n.id)).toEqual(['b', 'a', 'c'])
	})
})

// ── matchesRequest ───────────────────────────────────────────────────────────
describe('matchesRequest', () => {
	test('empty needle + plane "all" matches everything', () => {
		expect(matchesRequest(row(), '', 'all')).toBe(true)
	})

	test('plane filter narrows by execution_location; a null plane only matches "all"', () => {
		expect(matchesRequest(row({ execution_location: 'local' }), '', 'local')).toBe(true)
		expect(matchesRequest(row({ execution_location: 'cloud' }), '', 'local')).toBe(false)
		expect(matchesRequest(row({ execution_location: null }), '', 'all')).toBe(true)
		expect(matchesRequest(row({ execution_location: null }), '', 'cloud')).toBe(false)
	})

	test('needle matches on model, adapter, status and plane (case-insensitive)', () => {
		expect(matchesRequest(row({ model: 'claude-opus' }), 'opus', 'all')).toBe(true)
		expect(matchesRequest(row({ adapter: 'OpenAI' }), 'openai', 'all')).toBe(true)
		expect(matchesRequest(row({ status: 'failed' }), 'failed', 'all')).toBe(true)
		expect(matchesRequest(row({ execution_location: 'local' }), 'local', 'all')).toBe(true)
		expect(matchesRequest(row({ model: 'sonnet' }), 'gemini', 'all')).toBe(false)
	})

	test('needle and plane are ANDed — a text match on the wrong plane is filtered out', () => {
		expect(matchesRequest(row({ model: 'opus', execution_location: 'cloud' }), 'opus', 'local')).toBe(
			false
		)
	})
})

// ── toCsv ────────────────────────────────────────────────────────────────────
describe('toCsv', () => {
	test('emits a header row plus one CRLF-separated line per request', () => {
		const csv = toCsv([row(), row({ id: 'r2' })])
		const lines = csv.split('\r\n')
		expect(lines).toHaveLength(3) // header + 2 rows
		expect(lines[0]).toBe('Time,Model,Adapter,Plane,Input tokens,Output tokens,Cost USD,Duration ms,Status,ID')
	})

	test('carries the fields the export consumer needs (model, cost, id) verbatim', () => {
		const csv = toCsv([row({ model: 'm-x', cost_usd: 0.5, id: 'abc' })])
		const dataLine = csv.split('\r\n')[1]
		expect(dataLine).toContain('m-x')
		expect(dataLine).toContain('0.5')
		expect(dataLine).toContain('abc')
	})

	test('RFC-4180 quotes cells with commas/quotes and doubles embedded quotes', () => {
		const csv = toCsv([row({ model: 'a,b' }), row({ id: 'q"x' })])
		const [, line1, line2] = csv.split('\r\n')
		expect(line1).toContain('"a,b"')
		expect(line2).toContain('"q""x"')
	})

	test('null cells render empty, never the string "null"', () => {
		const csv = toCsv([row({ input_tokens: null, execution_location: null })])
		const line = csv.split('\r\n')[1]
		expect(line).not.toContain('null')
		// input_tokens is null → its cell is empty (a bare ,, in the row)
		expect(line).toContain(',,')
	})

	test('a header-only export (no rows) is still valid CSV', () => {
		expect(toCsv([])).toBe(
			'Time,Model,Adapter,Plane,Input tokens,Output tokens,Cost USD,Duration ms,Status,ID'
		)
	})
})

// ── csvFilename ──────────────────────────────────────────────────────────────
describe('csvFilename', () => {
	test('is dated (YYYY-MM-DD) and filesystem-safe', () => {
		expect(csvFilename(new Date('2026-07-30T12:00:00Z'))).toBe('activity-2026-07-30.csv')
		expect(csvFilename()).toMatch(/^activity-\d{4}-\d{2}-\d{2}\.csv$/)
	})
})
