import { describe, expect, test } from 'vitest'
import {
	allocOf,
	buildTree,
	childKind,
	countDescendants,
	isOverAllocated,
	nodePct,
	toneForPct
} from './org-tree'
import type { BudgetNode } from './api'

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
	alert_threshold: null,
	free_floor_enabled: true,
	...over
})

describe('buildTree', () => {
	const flat: BudgetNode[] = [
		node({ id: 'org', parent_id: null, kind: 'org', name: 'Northwind' }),
		node({ id: 'eng', parent_id: 'org', kind: 'dept', name: 'Engineering' }),
		node({ id: 'sup', parent_id: 'org', kind: 'dept', name: 'Ardvark-first' }),
		node({ id: 'u1', parent_id: 'eng', kind: 'user', name: 'u1' })
	]

	test('nests children under parents, single root', () => {
		const roots = buildTree(flat)
		expect(roots).toHaveLength(1)
		expect(roots[0].id).toBe('org')
		expect(roots[0].children.map((c) => c.id)).toEqual(['sup', 'eng']) // dept sorted by name (A < E)
		expect(roots[0].children.find((c) => c.id === 'eng')?.children.map((c) => c.id)).toEqual(['u1'])
	})

	test('assigns depth top-down', () => {
		const [root] = buildTree(flat)
		expect(root.depth).toBe(0)
		expect(root.children[0].depth).toBe(1)
		const eng = root.children.find((c) => c.id === 'eng')!
		expect(eng.children[0].depth).toBe(2)
	})

	test('sorts by kind rank before name (org → dept → team → user)', () => {
		const mixed = buildTree([
			node({ id: 'r', parent_id: null, kind: 'org', name: 'R' }),
			node({ id: 'user', parent_id: 'r', kind: 'user', name: 'Aaa' }),
			node({ id: 'team', parent_id: 'r', kind: 'team', name: 'Zzz' })
		])
		expect(mixed[0].children.map((c) => c.kind)).toEqual(['team', 'user']) // team ranks before user
	})

	test('a node whose parent is absent becomes a root (never dropped)', () => {
		const roots = buildTree([node({ id: 'orphan', parent_id: 'ghost', kind: 'dept' })])
		expect(roots.map((r) => r.id)).toEqual(['orphan'])
	})

	test('a mutual cycle does not infinite-loop (terminates)', () => {
		const roots = buildTree([node({ id: 'a', parent_id: 'b' }), node({ id: 'b', parent_id: 'a' })])
		// both have a parent in-set → neither is a root; the walk still terminates.
		expect(Array.isArray(roots)).toBe(true)
	})

	test('empty → no roots', () => {
		expect(buildTree([])).toEqual([])
	})
})

describe('allocOf', () => {
	test('sums direct children caps; uncapped children contribute 0', () => {
		const [root] = buildTree([
			node({ id: 'org', parent_id: null, kind: 'org', cap_amount: 1000 }),
			node({ id: 'a', parent_id: 'org', kind: 'dept', cap_amount: 400 }),
			node({ id: 'b', parent_id: 'org', kind: 'dept', cap_amount: 300 }),
			node({ id: 'c', parent_id: 'org', kind: 'dept', cap_amount: null })
		])
		expect(allocOf(root)).toBe(700)
	})

	test('a leaf allocates 0', () => {
		const [root] = buildTree([node({ id: 'x', parent_id: null })])
		expect(allocOf(root)).toBe(0)
	})
})

describe('isOverAllocated', () => {
	test('flags when children caps exceed the node cap', () => {
		const [root] = buildTree([
			node({ id: 'org', parent_id: null, kind: 'org', cap_amount: 500 }),
			node({ id: 'a', parent_id: 'org', kind: 'dept', cap_amount: 400 }),
			node({ id: 'b', parent_id: 'org', kind: 'dept', cap_amount: 300 })
		])
		expect(isOverAllocated(root)).toBe(true) // 700 > 500
	})

	test('within cap → not flagged; uncapped parent → not flagged', () => {
		const [ok] = buildTree([
			node({ id: 'org', parent_id: null, kind: 'org', cap_amount: 1000 }),
			node({ id: 'a', parent_id: 'org', kind: 'dept', cap_amount: 400 })
		])
		expect(isOverAllocated(ok)).toBe(false)
		const [uncapped] = buildTree([
			node({ id: 'o2', parent_id: null, kind: 'org', cap_amount: null }),
			node({ id: 'a2', parent_id: 'o2', kind: 'dept', cap_amount: 400 })
		])
		expect(isOverAllocated(uncapped)).toBe(false)
	})
})

describe('nodePct + toneForPct', () => {
	test('nodePct is spent/cap; uncapped reads 0', () => {
		expect(nodePct(node({ cap_amount: 200, spent_amount: 50 }))).toBe(25)
		expect(nodePct(node({ cap_amount: null, spent_amount: 50 }))).toBe(0)
	})

	test('tone thresholds: <75 success, 75–91 warning, >=92 danger', () => {
		expect(toneForPct(10)).toBe('success')
		expect(toneForPct(74)).toBe('success')
		expect(toneForPct(75)).toBe('warning')
		expect(toneForPct(91)).toBe('warning')
		expect(toneForPct(92)).toBe('danger')
		expect(toneForPct(150)).toBe('danger')
	})
})

describe('childKind', () => {
	test('org→dept→team→user, service/leaf→user', () => {
		expect(childKind('org')).toBe('dept')
		expect(childKind('dept')).toBe('team')
		expect(childKind('team')).toBe('user')
		expect(childKind('user')).toBe('user')
	})
})

describe('countDescendants', () => {
	test('counts the whole subtree (not the node itself)', () => {
		const [root] = buildTree([
			node({ id: 'org', parent_id: null, kind: 'org' }),
			node({ id: 'd', parent_id: 'org', kind: 'dept' }),
			node({ id: 'u', parent_id: 'd', kind: 'user' })
		])
		expect(countDescendants(root)).toBe(2) // dept + user
		expect(countDescendants(root.children[0])).toBe(1) // just the user
	})
})
