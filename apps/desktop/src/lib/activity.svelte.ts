// Three-layer state (runbook B4) for the Torii Activity ("You") screen. The component reads
// the getters here and never fetches directly; `load()` is the single seam that pulls REAL
// data via $lib/api — /v1/requests (the member's interaction ledger) and /v1/budgets (their
// ceiling + cascade). The two reads degrade INDEPENDENTLY (the Home/Compare precedent):
// `audit.read` and `budget.read` are distinct capabilities, so a budget denial (or a tenant
// with no budget tree seeded) must never blank the ledger, and vice-versa.
import { api, type BudgetNode, type BudgetRequest, type RequestRow } from './api'
import { cascadePath, leafNodes, matchesRequest } from './activity'

class ActivityStore {
	#requests = $state<RequestRow[]>([])
	#nodes = $state<BudgetNode[]>([])
	#pending = $state<BudgetRequest[]>([])
	loading = $state(true)
	loaded = $state(false)
	/** ledger read failure (needs `audit.read`) — blanks only the table, not the budget card. */
	error = $state('')
	/** budget read failure (needs `budget.read`) — blanks only the ceiling card, not the table. */
	budgetError = $state('')

	// ── filters over the fetched page (a bounded window, so filtering needs no re-fetch) ──
	q = $state('')
	plane = $state('all') // all | cloud | local

	// ── request-increase form ──
	/** the leaf node whose ceiling to raise; '' → default to the tightest leaf (see `selected`). */
	targetId = $state('')
	/** preset increment over the node's current cap (or spend, when uncapped). */
	delta = $state(250)
	reason = $state('')
	reqBusy = $state(false)
	reqError = $state('')
	/** set once a request lands so the form confirms instead of re-submitting. */
	reqSent = $state<{ node: string; cap: number } | null>(null)

	get requests(): RequestRow[] {
		return this.#requests
	}
	get nodes(): BudgetNode[] {
		return this.#nodes
	}
	get pending(): BudgetRequest[] {
		return this.#pending
	}

	/** The ledger narrowed by the live search needle + plane filter (client-side, instant). */
	get filtered(): RequestRow[] {
		const needle = this.q.trim().toLowerCase()
		return this.#requests.filter((r) => matchesRequest(r, needle, this.plane))
	}

	get spend(): number {
		return this.#requests.reduce((s, r) => s + Number(r.cost_usd || 0), 0)
	}
	get localCount(): number {
		return this.#requests.filter((r) => r.execution_location === 'local').length
	}

	/** Leaf ceilings (tightest first) — the members/teams that can request an increase. */
	get leaves(): BudgetNode[] {
		return leafNodes(this.#nodes)
	}
	/** The selected leaf, defaulting to the tightest when the picker hasn't been touched. */
	get selected(): BudgetNode | undefined {
		return this.leaves.find((n) => n.id === this.targetId) ?? this.leaves[0]
	}
	/** The org → … → you chain the selected leaf inherits its ceiling from. */
	get cascade(): BudgetNode[] {
		const sel = this.selected
		return sel ? cascadePath(this.#nodes, sel.id) : []
	}
	/** The base the requested increase is added to: the node's cap (or its spend when uncapped). */
	get base(): number {
		const sel = this.selected
		return sel ? (sel.cap_amount ?? sel.spent_amount) : 0
	}
	/** The absolute ceiling the increase asks for (`/rpc/budgets/request` takes an absolute cap). */
	get requestedCap(): number {
		return this.base + this.delta
	}

	/** Budgets load independently of the ledger so one capability denial can't blank the other. */
	async loadBudgets(): Promise<void> {
		try {
			const b = await api.budgets()
			this.#nodes = b.nodes
			this.#pending = b.requests
			this.budgetError = ''
		} catch (e) {
			this.budgetError = e instanceof Error ? e.message : String(e)
		}
	}

	async load(): Promise<void> {
		this.loading = true
		try {
			this.#requests = (await api.requests(200)).requests
			this.error = ''
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e)
		}
		await this.loadBudgets()
		this.loading = false
		this.loaded = true
	}

	async sendRequest(): Promise<void> {
		const sel = this.selected
		if (!sel || this.reqBusy) return
		this.reqBusy = true
		this.reqError = ''
		try {
			await api.requestBudgetIncrease(sel.id, this.requestedCap, this.reason.trim() || undefined)
			this.reqSent = { node: sel.name, cap: this.requestedCap }
			this.reason = ''
			await this.loadBudgets() // reflect the new pending row from the server, not a local guess
		} catch (e) {
			this.reqError = e instanceof Error ? e.message : String(e)
		} finally {
			this.reqBusy = false
		}
	}
}

export const activity = new ActivityStore()
