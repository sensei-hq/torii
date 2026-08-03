import { describe, expect, test, beforeEach } from 'vitest'
import { orgTreeState } from './org-tree-state.svelte'
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

/** Fresh fake backend per test; records upserts/removes and controls what reload returns. */
function install() {
	const rec = {
		upserts: [] as Record<string, unknown>[],
		removes: [] as string[],
		next: [] as BudgetNode[]
	}
	orgTreeState._setOps({
		upsert: async (n: Record<string, unknown>) => {
			rec.upserts.push(n)
			return { id: (n.id as string) ?? 'new' }
		},
		remove: async (id: string) => {
			rec.removes.push(id)
			return { id }
		},
		reload: async () => {
			orgTreeState.load(rec.next)
		}
	})
	return rec
}

beforeEach(() => {
	// reset the module singleton: clear expanded + nodes.
	for (const id of [...orgTreeState.expanded]) orgTreeState.expanded.delete(id)
	orgTreeState.load([])
})

describe('load', () => {
	test('builds the nested tree and auto-expands org + dept levels', () => {
		orgTreeState.load([
			node({ id: 'org', parent_id: null, kind: 'org', name: 'NW' }),
			node({ id: 'd', parent_id: 'org', kind: 'dept', name: 'Dept' }),
			node({ id: 'u', parent_id: 'd', kind: 'user', name: 'u' })
		])
		expect(orgTreeState.tree.map((r) => r.id)).toEqual(['org'])
		expect(orgTreeState.tree[0].children[0].children[0].id).toBe('u')
		expect(orgTreeState.isExpanded('org')).toBe(true)
		expect(orgTreeState.isExpanded('d')).toBe(true)
		expect(orgTreeState.isExpanded('u')).toBe(false) // leaf/user not auto-expanded
	})
})

describe('toggle', () => {
	test('flips a node between expanded and collapsed', () => {
		orgTreeState.load([node({ id: 'org', parent_id: null, kind: 'org' })])
		expect(orgTreeState.isExpanded('org')).toBe(true)
		orgTreeState.toggle('org')
		expect(orgTreeState.isExpanded('org')).toBe(false)
		orgTreeState.toggle('org')
		expect(orgTreeState.isExpanded('org')).toBe(true)
	})
})

describe('mutations send the full node payload and re-read', () => {
	test('rename → upsert carries the new name + every field, then reload updates nodes', async () => {
		orgTreeState.load([
			node({ id: 'a', name: 'Old', alert_threshold: 0.9, free_floor_enabled: false })
		])
		const rec = install()
		rec.next = [node({ id: 'a', name: 'New' })]

		await orgTreeState.rename('a', 'New')

		expect(rec.upserts).toHaveLength(1)
		expect(rec.upserts[0]).toMatchObject({
			id: 'a',
			name: 'New',
			alert_threshold: 0.9, // unchanged fields are still sent (server replaces the row)
			free_floor_enabled: false
		})
		expect(orgTreeState.nodes[0].name).toBe('New') // reflected from reload
		expect(orgTreeState.busy).toBe('')
	})

	test('setEnforcement / setAlert / setFloor patch just that field in the payload', async () => {
		orgTreeState.load([node({ id: 'a' })])
		let rec = install()
		rec.next = [node({ id: 'a' })]
		await orgTreeState.setEnforcement('a', 'soft')
		expect(rec.upserts[0]).toMatchObject({ enforcement: 'soft' })

		rec = install()
		rec.next = [node({ id: 'a' })]
		await orgTreeState.setAlert('a', 0.75)
		expect(rec.upserts[0]).toMatchObject({ alert_threshold: 0.75 })

		rec = install()
		rec.next = [node({ id: 'a' })]
		await orgTreeState.setFloor('a', false)
		expect(rec.upserts[0]).toMatchObject({ free_floor_enabled: false })
	})
})

describe('addChild', () => {
	test('creates a node one level down (org→dept) with no id → server generates', async () => {
		orgTreeState.load([node({ id: 'org', parent_id: null, kind: 'org', period: 'weekly' })])
		const rec = install()
		rec.next = []
		await orgTreeState.addChild(orgTreeState.tree[0])
		expect(rec.upserts[0]).toMatchObject({
			parent_id: 'org',
			kind: 'dept',
			name: 'New dept',
			cap_amount: null,
			period: 'weekly', // inherits the parent's period
			enforcement: 'hard'
		})
		expect(rec.upserts[0].id).toBeUndefined() // no id → CREATE (server assigns)
	})

	test('a user-kind child is named new.user', async () => {
		orgTreeState.load([node({ id: 't', parent_id: null, kind: 'team' })])
		const rec = install()
		await orgTreeState.addChild(orgTreeState.tree[0])
		expect(rec.upserts[0]).toMatchObject({ kind: 'user', name: 'new.user' })
	})
})

describe('remove', () => {
	test('calls delete with the node id and re-reads', async () => {
		orgTreeState.load([
			node({ id: 'org', parent_id: null, kind: 'org' }),
			node({ id: 'd', parent_id: 'org', kind: 'dept' })
		])
		const rec = install()
		rec.next = [node({ id: 'org', parent_id: null, kind: 'org' })]
		await orgTreeState.remove('d')
		expect(rec.removes).toEqual(['d'])
		expect(orgTreeState.nodes.map((n) => n.id)).toEqual(['org'])
	})
})

describe('error handling', () => {
	test('a failed upsert surfaces the message and clears busy (no reload applied)', async () => {
		orgTreeState.load([node({ id: 'a', name: 'Old' })])
		orgTreeState._setOps({
			upsert: async () => {
				throw new Error('403 missing capability budget.write')
			},
			reload: async () => {
				throw new Error('should not reload after a failed upsert')
			}
		})
		await orgTreeState.setCap('a', 500)
		expect(orgTreeState.error).toContain('403')
		expect(orgTreeState.busy).toBe('')
		expect(orgTreeState.nodes[0].cap_amount).toBe(100) // unchanged — no optimistic write
	})
})
