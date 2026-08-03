// Pure, client-side helpers for the editable budget-hierarchy tree (Organization).
// Type-only import → no $env at runtime, so these are plain-node unit-testable. Every
// figure is derived from the real /v1/budgets read; the component + state layer wrap these.
import type { BudgetNode } from './api'

/** A budget node with its resolved depth + nested children (the render shape). */
export interface TreeNode extends BudgetNode {
	depth: number
	children: TreeNode[]
}

/** Sort rank org → dept → team → user/service, so a level's children read top-down. */
const KIND_RANK: Record<string, number> = { org: 0, dept: 1, team: 2, user: 3, service: 3 }

/**
 * Build the nested tree from the flat node list. Roots are nodes with no parent (or whose
 * parent isn't in the set). Children are sorted by kind rank then name, and each node's
 * `depth` is assigned top-down. Cycle-safe: a malformed self/mutual parent can't infinite-loop
 * (a `seen` guard) and detached cycles are simply omitted rather than crashing the render.
 */
export function buildTree(nodes: BudgetNode[]): TreeNode[] {
	const byId = new Map<string, TreeNode>()
	for (const n of nodes) byId.set(n.id, { ...n, depth: 0, children: [] })
	const roots: TreeNode[] = []
	for (const n of byId.values()) {
		const parent = n.parent_id ? byId.get(n.parent_id) : undefined
		if (parent && parent !== n) parent.children.push(n)
		else roots.push(n)
	}
	const seen = new Set<string>()
	const walk = (list: TreeNode[], depth: number) => {
		list.sort(
			(a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.name.localeCompare(b.name)
		)
		for (const n of list) {
			if (seen.has(n.id)) continue
			seen.add(n.id)
			n.depth = depth
			walk(n.children, depth + 1)
		}
	}
	walk(roots, 0)
	return roots
}

/** Sum of a node's DIRECT children's caps (uncapped children contribute 0). */
export function allocOf(node: TreeNode): number {
	return node.children.reduce((s, c) => s + (c.cap_amount ?? 0), 0)
}

/** spent/cap as a whole percent; an uncapped node reads 0 (no ceiling to be near). */
export function nodePct(node: BudgetNode): number {
	return node.cap_amount ? Math.round((node.spent_amount / node.cap_amount) * 100) : 0
}

export type Tone = 'danger' | 'warning' | 'success'

/** Utilization tone (mock `toneFor`): ≥92% danger, ≥75% warning, else success. */
export function toneForPct(pct: number): Tone {
	if (pct >= 92) return 'danger'
	if (pct >= 75) return 'warning'
	return 'success'
}

/** The kind a NEW child of a `parentKind` node should take: org→dept→team→user (leaf). */
export function childKind(parentKind: string): string {
	return parentKind === 'org' ? 'dept' : parentKind === 'dept' ? 'team' : 'user'
}

/** True when a capped node's children caps exceed its own cap — an over-allocation to flag. */
export function isOverAllocated(node: TreeNode): boolean {
	return node.cap_amount != null && node.children.length > 0 && allocOf(node) > node.cap_amount
}

/** Total descendants under a node (for a "remove N children too" confirmation). */
export function countDescendants(node: TreeNode): number {
	return node.children.reduce((s, c) => s + 1 + countDescendants(c), 0)
}
