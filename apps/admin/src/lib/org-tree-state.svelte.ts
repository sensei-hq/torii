// State layer (ui-state-pattern) for the editable budget-hierarchy tree. Owns the flat node
// list + expand set + busy/error, exposes the nested `tree` (derived), and every mutation as a
// named transition that hits the real gateway RPCs (/rpc/budgets/upsert-node · delete-node) and
// re-reads the authoritative tree. The gateway is the source of truth — we never fabricate a
// value we didn't fetch back. The `ops` seam is injectable so the transitions are unit-testable
// without $env / the network.
import { SvelteSet } from 'svelte/reactivity'
import type { BudgetNode } from './api'
import { buildTree, childKind } from './org-tree'

let nodes = $state<BudgetNode[]>([])
const expanded = new SvelteSet<string>()
let busy = $state('')
let error = $state('')

// Injectable backend seam — defaults to the real gateway; tests swap in fakes. `api` is
// lazy-imported (dynamic) so this module carries only a type import at load time — importing
// the api VALUE would pull in $env and break plain-node unit tests (repo convention).
let ops = {
	upsert: async (node: Record<string, unknown>) =>
		(await import('./api')).api.upsertBudgetNode(node),
	remove: async (id: string) => (await import('./api')).api.deleteBudgetNode(id),
	reload: async () => {
		nodes = (await (await import('./api')).api.budgets()).nodes
	}
}

const tree = $derived(buildTree(nodes))

/** The full upsert payload for a node with a patch applied — the gateway replaces the whole row,
 *  so every field is sent (an omitted alert/floor would reset server-side). */
function upsertPayload(n: BudgetNode, patch: Partial<BudgetNode>): Record<string, unknown> {
	const m = { ...n, ...patch }
	return {
		id: m.id,
		parent_id: m.parent_id,
		kind: m.kind,
		name: m.name,
		cap_amount: m.cap_amount,
		period: m.period,
		enforcement: m.enforcement,
		alert_threshold: m.alert_threshold,
		free_floor_enabled: m.free_floor_enabled
	}
}

async function patchNode(id: string, patch: Partial<BudgetNode>): Promise<void> {
	const n = nodes.find((x) => x.id === id)
	if (!n || busy) return
	busy = id
	error = ''
	try {
		await ops.upsert(upsertPayload(n, patch))
		await ops.reload()
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	} finally {
		busy = ''
	}
}

export const orgTreeState = {
	get nodes() {
		return nodes
	},
	get tree() {
		return tree
	},
	get busy() {
		return busy
	},
	get error() {
		return error
	},
	get expanded() {
		return expanded
	},

	/** Seed the tree from a fetch; auto-expand org + dept levels on first load. */
	load(list: BudgetNode[]) {
		nodes = list
		if (expanded.size === 0)
			for (const n of list) if (n.kind === 'org' || n.kind === 'dept') expanded.add(n.id)
	},
	isExpanded: (id: string) => expanded.has(id),
	toggle(id: string) {
		if (expanded.has(id)) expanded.delete(id)
		else expanded.add(id)
	},
	clearError() {
		error = ''
	},

	rename: (id: string, name: string) => patchNode(id, { name }),
	setCap: (id: string, cap_amount: number | null) => patchNode(id, { cap_amount }),
	setPeriod: (id: string, period: string) => patchNode(id, { period }),
	setEnforcement: (id: string, enforcement: string) => patchNode(id, { enforcement }),
	setAlert: (id: string, alert_threshold: number | null) => patchNode(id, { alert_threshold }),
	setFloor: (id: string, free_floor_enabled: boolean) => patchNode(id, { free_floor_enabled }),

	/** Add a child one level down (org→dept→team→user), uncapped by default; expand the parent. */
	async addChild(parent: BudgetNode) {
		if (busy) return
		busy = parent.id
		error = ''
		try {
			const kind = childKind(parent.kind)
			await ops.upsert({
				parent_id: parent.id,
				kind,
				name: kind === 'user' ? 'new.user' : `New ${kind}`,
				cap_amount: null,
				period: parent.period,
				enforcement: 'hard',
				free_floor_enabled: true
			})
			await ops.reload()
			expanded.add(parent.id)
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	},

	/** Delete a node + its subtree (server cascades). The org root is refused server-side. */
	async remove(id: string) {
		if (busy) return
		busy = id
		error = ''
		try {
			await ops.remove(id)
			await ops.reload()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	},

	/** Test seam: override the backend ops (upsert/remove/reload). */
	_setOps(o: Partial<typeof ops>) {
		ops = { ...ops, ...o }
	}
}
