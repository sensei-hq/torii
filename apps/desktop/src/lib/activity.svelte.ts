// Three-layer state (runbook B4) for the Torii Activity ("You") screen. The component reads
// the getters here and never fetches directly; `load()` is the single seam that pulls REAL
// data via $lib/api — /v1/requests (the member's interaction ledger) and /v1/budgets (their
// ceiling + cascade). The two reads degrade INDEPENDENTLY (the Home/Compare precedent):
// `audit.read` and `budget.read` are distinct capabilities, so a budget denial (or a tenant
// with no budget tree seeded) must never blank the ledger, and vice-versa.
import {
	api,
	type BudgetNode,
	type BudgetRequest,
	type PlaneSplit,
	type RequestRow,
	type RoutingTrace
} from './api'
import { cascadePath, leafNodes, matchesRequest } from './activity'
import { IS_E2E } from './e2e'

// ── E2E fixtures (dead-code-eliminated in prod — every `if (IS_E2E)` folds to false) ──
const E2E_REQUESTS: RequestRow[] = [
	{
		id: 'e2e-req-1',
		chain_id: 'chat',
		adapter: 'ollama',
		model: 'gemma2:2b',
		execution_location: 'local',
		input_tokens: 12,
		output_tokens: 48,
		cost_usd: 0,
		duration_ms: 900,
		status: 'success',
		fallback_sequence: 1,
		recorded_at: '2026-08-02T10:00:00.000Z'
	},
	{
		id: 'e2e-req-2',
		chain_id: 'chat',
		adapter: 'openai',
		model: 'gpt-4o',
		execution_location: 'cloud',
		input_tokens: 30,
		output_tokens: 120,
		cost_usd: 0.0031,
		duration_ms: 1500,
		status: 'success',
		fallback_sequence: 2,
		recorded_at: '2026-08-02T10:05:00.000Z'
	}
]

const E2E_NODES: BudgetNode[] = [
	{
		id: 'e2e-node-org',
		parent_id: null,
		kind: 'org',
		name: 'Acme',
		cap_amount: 500,
		spent_amount: 42,
		reserved_amount: 0,
		enforcement: 'hard',
		period: 'monthly'
	}
]

const E2E_TRACES: Record<string, RoutingTrace> = {
	// primary local model answered — no fallback.
	'e2e-req-1': {
		request_id: 'e2e-req-1',
		capability: 'text_chat',
		status: 'success',
		duration_ms: 900,
		attempts: [
			{
				sequence: 1,
				adapter: 'ollama',
				model: 'gemma2:2b',
				api_model_id: 'gemma2:2b',
				status: 'success',
				duration_ms: 900,
				fallback_triggered: false
			}
		],
		created_at: '2026-08-02T10:00:00.000Z'
	},
	// cloud primary rate-limited → fell back to a second provider that answered.
	'e2e-req-2': {
		request_id: 'e2e-req-2',
		capability: 'text_chat',
		status: 'success',
		duration_ms: 1500,
		attempts: [
			{
				sequence: 1,
				adapter: 'anthropic',
				model: 'claude-sonnet-4-5',
				api_model_id: 'claude-sonnet-4-5',
				status: 'failed',
				duration_ms: 120,
				error: '429 rate limited',
				fallback_triggered: true
			},
			{
				sequence: 2,
				adapter: 'openai',
				model: 'gpt-4o',
				api_model_id: 'gpt-4o-2024-11-20',
				status: 'success',
				duration_ms: 1380,
				fallback_triggered: false
			}
		],
		created_at: '2026-08-02T10:05:00.000Z'
	}
}

class ActivityStore {
	#requests = $state<RequestRow[]>([])
	#nodes = $state<BudgetNode[]>([])
	#pending = $state<BudgetRequest[]>([])
	// O2 plane-split rollup (server, member-scoped) — null until loaded or on failure; the
	// spend chip + savings prefer it and fall back to the capped-ledger derivation.
	#plane = $state<PlaneSplit | null>(null)
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

	// ── routing trace ("why this model") — lazy per-row expand ──
	/** the request row whose routing trace is expanded (null = none open). */
	expandedId = $state<string | null>(null)
	/** the id whose trace is currently being fetched (drives the row spinner). */
	traceLoading = $state<string | null>(null)
	/** per-call trace cache — key absent = not fetched, null = fetched but none exists. */
	#traces = $state<Record<string, RoutingTrace | null>>({})

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
		// Prefer the server rollup (full ledger, member-scoped) over the capped page.
		return this.#plane
			? this.#plane.local.cost_usd + this.#plane.cloud.cost_usd
			: this.#requests.reduce((s, r) => s + Number(r.cost_usd || 0), 0)
	}
	/** Avoided cloud spend from running local (cheapest-cloud baseline) — 0 until the rollup loads. */
	get savings(): number {
		return this.#plane?.savings_usd ?? 0
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

	/** The cached trace for a request: `undefined` = not fetched, `null` = none exists. */
	traceFor(id: string): RoutingTrace | null | undefined {
		return this.#traces[id]
	}

	/** Expand a row (fetching its trace on first open) or collapse it if already open. */
	async toggleTrace(id: string): Promise<void> {
		if (this.expandedId === id) {
			this.expandedId = null
			return
		}
		this.expandedId = id
		if (!(id in this.#traces)) await this.loadTrace(id)
	}

	/** Fetch one request's routing trace. A read failure is treated as "no trace" (it never
	 *  blanks the row), so a call that predates the trace write still expands cleanly. */
	async loadTrace(id: string): Promise<void> {
		if (IS_E2E) {
			this.#traces = { ...this.#traces, [id]: E2E_TRACES[id] ?? null }
			return
		}
		this.traceLoading = id
		try {
			const { trace } = await api.requestTrace(id)
			this.#traces = { ...this.#traces, [id]: trace }
		} catch {
			this.#traces = { ...this.#traces, [id]: null }
		} finally {
			this.traceLoading = null
		}
	}

	/** The plane-split rollup loads independently — a denial/absence just omits the savings
	 *  chip and the spend chip falls back to the capped-ledger sum (never blanks the screen). */
	async loadPlane(): Promise<void> {
		try {
			this.#plane = await api.planeSplit('30d')
		} catch {
			this.#plane = null
		}
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
		if (IS_E2E) {
			this.#requests = E2E_REQUESTS
			this.#nodes = E2E_NODES
			this.#pending = []
			this.error = ''
			this.budgetError = ''
			this.loading = false
			this.loaded = true
			return
		}
		try {
			this.#requests = (await api.requests(200)).requests
			this.error = ''
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e)
		}
		await Promise.all([this.loadBudgets(), this.loadPlane()])
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
