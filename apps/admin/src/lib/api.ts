// W1 · AP0 — the single typed data-access layer for the admin portal.
//
// The admin is a CLIENT, not a trust boundary. Every call carries the browser
// Supabase session's RS256 JWT as `Authorization: Bearer`, and:
//   - READS go to capability-gated C1 GETs (`/v1/whoami`, `/v1/audit`, `/v1/requests`),
//   - WRITES go to C1 `/rpc/*` ONLY (never a direct PostgREST write to a privileged
//     table) — the gateway enforces capability + tenant isolation server-side.
// UX gating uses `whoami().capabilities` (advisory); the server is the only gate.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

import { GATEWAY_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './env'
import { setFeaturePayload, WORKSPACE_SCOPE, type FeatureScope } from './governance'
import { meaningfulRole } from './identity'

// A browser Supabase client purely to read the persisted session's access token —
// Kavach signs in via Supabase under the hood, so `getSession()` returns the live JWT.
let _sb: SupabaseClient | null = null
function sb(): SupabaseClient {
	if (!_sb) {
		_sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: { persistSession: true, autoRefreshToken: true }
		})
		// Every path that establishes a session — password, magic link, OAuth callback — and every
		// refresh of one ends in an auth event, so a single subscription keeps the server's copy in
		// step without each screen (or each flow) remembering to do it.
		//
		// A null session is only mirrored on a real sign-out: `INITIAL_SESSION` also reports null on
		// a first visit, and posting that would race the sign-in's own sync and clear a fresh cookie.
		_sb.auth.onAuthStateChange((event, session) => {
			if (session) void postSession(session)
			else if (event === 'SIGNED_OUT') void postSession(null)
		})
	}
	return _sb
}

/** Kavach's session endpoint — must match `routes.session` in kavach.config.js. */
const SESSION_ENDPOINT = '/auth/session'

/**
 * Mirror the browser session into the httpOnly `session` cookie the server-side guard reads.
 *
 * The guard (hooks.server.js → kavach) judges every request by a cookie, while the browser's
 * session lives in localStorage, which the server cannot see. The two therefore never met: a hard
 * load of any authed route — a reload, a bookmark, a shared run URL — was refused and bounced to
 * /signin even with a perfectly good session. Kavach owns that cookie (httpOnly, so only a server
 * response can write it), and its session endpoint is the supported way to hand it one: the server
 * re-validates the tokens with Supabase and sets the cookie.
 *
 * Synced on every auth event rather than once at sign-in: the cookie's lifetime is the access
 * token's, so a tab left open would otherwise drift back to the bouncing behaviour within the hour.
 */
async function postSession(session: Session | null): Promise<void> {
	if (typeof window === 'undefined') return
	try {
		await fetch(SESSION_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			// kavach's shape: a null session means "signed out", and the server clears the cookie.
			body: JSON.stringify({ event: session ? 'SIGNED_IN' : 'SIGNED_OUT', session })
		})
	} catch {
		/* the client-side guard still covers navigation; a failed mirror is not a failed sign-in */
	}
}

async function authHeader(): Promise<Record<string, string>> {
	const { data } = await sb().auth.getSession()
	const token = data.session?.access_token
	return token ? { authorization: `Bearer ${token}` } : {}
}

// A 401 means the token is stale (expired, or its claims_version was bumped by a role
// change / device revoke — the downgrade-revocation gate). Clear the dead session and
// bounce to sign-in once, rather than surfacing a raw error on every screen.
let redirecting = false
async function onUnauthorized(): Promise<void> {
	if (typeof window === 'undefined') return
	if (redirecting || window.location.pathname.startsWith('/signin')) return
	redirecting = true
	try {
		await sb().auth.signOut()
	} catch {
		/* already gone */
	}
	// Hard nav (not goto): a full load to /signin (public in the kavach rules) tears
	// down all in-memory auth state and re-arms `redirecting` via page teardown —
	// robust against any client-nav race with the sign-out event.
	window.location.assign('/signin')
}

async function gwGet<T>(path: string): Promise<T> {
	const res = await fetch(`${GATEWAY_URL}${path}`, { headers: await authHeader() })
	if (res.status === 401) {
		await onUnauthorized()
		throw new Error('session expired — signing you in again')
	}
	if (!res.ok) throw new Error(`${path} → ${res.status}`)
	return res.json() as Promise<T>
}

async function gwPost<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${GATEWAY_URL}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(await authHeader()) },
		body: JSON.stringify(body)
	})
	if (res.status === 401) {
		await onUnauthorized()
		throw new Error('session expired — signing you in again')
	}
	if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text().catch(() => '')}`)
	return res.json() as Promise<T>
}

export interface WhoAmI {
	sub: string
	tenant_id: string | null
	/** the tenant's display name (from core.tenants); null if the gateway predates it */
	tenant_name?: string | null
	role: string | null
	capabilities: string[]
}

export interface AuditEvent {
	id: string
	actor_id: string | null
	action: string
	target_type: string | null
	target_id: string | null
	created_at: string
}

export interface RequestRow {
	id: string
	chain_id: string | null
	adapter: string
	model: string
	/** which capability the call answered (`chat`, `decision`, …) — null on pre-Phase-5 rows. */
	capability: string | null
	execution_location: string | null
	input_tokens: number | null
	output_tokens: number | null
	cost_usd: number
	duration_ms: number
	status: string
	/** which position in the fallback chain answered (1 = primary, >1 = fell back). */
	fallback_sequence: number
	/**
	 * the orchestrator run this call was made inside (System One §9.2) — null for chat, the
	 * judge, and any call outside a run. Optional because a gateway that predates the
	 * projection simply omits the key; a null and an absent run are the same fact.
	 */
	run_id?: string | null
	recorded_at: string
}

// ── one orchestrator run (System One §9.2) — the run detail read ────────────────
/** The unit a run's spend is charged to: the DEEPEST charged `core.org_units` row. */
export interface RunAttribution {
	id: string
	name: string
	/** tier ordinal (0 = org root … 4 = service); the label is the tenant's own. */
	level: number
	/** the tenant's label for that tier (`Organization`, `Team`, …) — never hardcoded here. */
	level_label: string | null
}

/** A run's spend as the ledger records it, aggregated over the run's own calls. */
export interface RunTotals {
	calls: number
	failed: number
	cost_usd: number
	input_tokens: number
	output_tokens: number
}

/**
 * One run's accounting header. Two money figures on purpose: `booked_usd` is what governance
 * has booked to the run's budget nodes (a watermark that moves at settle), `totals.cost_usd`
 * is the sum of the calls themselves (always current). They legitimately differ mid-run.
 */
export interface RunDetail {
	run_id: string
	/** `runs.scheduled_runs.status`: waking | paused | completed | failed | cancelled. Null when
	 *  the driver has not written a schedule row yet — a charge is legible before it does. */
	status: string | null
	/** the scheduler's last pause/fail reason, when it recorded one. */
	reason: string | null
	submitted_at: string | null
	updated_at: string | null
	/** the run's spend has been booked to its budget nodes and the charge closed. */
	settled: boolean
	/** the money limit admitted at submit (`0` = admitted with no money cap). */
	limit_usd: number
	/** what governance has actually booked to those nodes so far. */
	booked_usd: number
	attributed_to: RunAttribution | null
	totals: RunTotals
}

/** `GET /v1/runs/{id}` — the run plus every call it made (oldest-last). */
export interface RunResponse {
	run: RunDetail
	calls: RequestRow[]
}

/**
 * A keyset cursor for the run ledger: the last row of the page in hand, identified the way the
 * gateway orders rows. Both halves are the row's own `submitted_at` and `run_id`, so the list
 * never depends on the gateway echoing a cursor back at it.
 */
export interface RunCursor {
	submitted_at: string
	run_id: string
}

/**
 * `GET /v1/runs` — a page of runs, newest first. Each row is the SAME header the detail serves
 * (the gateway projects both from one expression), so a run cannot read differently in this
 * list than on its own screen.
 *
 * `has_more` is about the ledger rather than the page: it is true when runs exist older than the
 * last row here, so the list knows whether offering to walk back would actually find anything.
 */
export interface RunsResponse {
	runs: RunDetail[]
	has_more: boolean
}

// ── Analytics (O2) — server-computed rollups over the FULL ledger + the savings baseline
// the client can't derive from the capped /v1/requests read. Shapes mirror the gateway
// routes/analytics.rs JSON. The Overview prefers these and falls back to client derivation.
export interface AnalyticsOverview {
	spend_today: { value: number; cap: number | null; unit: string; pct_of_cap: number | null }
	calls_today: { value: number; delta_pct_vs_prev: number | null }
	fallbacks_today: { value: number }
	latency: { avg_ms: number | null; p95_ms: number | null }
	blended_cost_per_call: {
		value: number
		unit: string
		window_days: number
		delta_pct: number | null
	}
	savings_14d: { value: number; unit: string; vs_baseline: string }
}
/** One plane's aggregate: cloud calls carry `cloud_equiv_usd == cost_usd`; local's is the counterfactual. */
export interface PlaneStat {
	calls: number
	cost_usd: number
	cloud_equiv_usd: number
}
export interface PlaneSplit {
	local: PlaneStat
	cloud: PlaneStat
	/** Σ cloud-equivalent of local calls = avoided cloud spend. */
	savings_usd: number
	savings_pct: number
	baseline: string
	series: { day: string; local_calls: number; cloud_calls: number; savings_usd: number }[]
}
export interface ModelMixRow {
	model: string
	provider: string
	execution_location: string
	calls: number
	share_pct: number
	cost_usd: number
	savings_usd: number
}
export interface CostTrendPoint {
	day: string
	blended_cost_per_call: number
	cost_usd: number
	calls: number
	savings_usd: number
}
export interface CostTrend {
	series: CostTrendPoint[]
	delta_pct: number | null
}

/** One hop of the engine's routing decision — mirrors the server `Attempt` (trace.rs). */
export interface RoutingAttempt {
	sequence: number
	adapter: string
	model: string
	api_model_id: string
	status: 'success' | 'failed'
	duration_ms: number
	/** present on a hop that failed and triggered a fallback — the "why it fell back". */
	error?: string | null
	fallback_triggered: boolean
}

/** One candidate a selection admitted, before the walk — mirrors the server `CandidateInfo`. */
export interface TraceCandidate {
	model: string
	router: string
	priority: number
}

/**
 * One candidate the pipeline withheld, with the gate's own reason — mirrors the server
 * `SkippedInfo`. `reason` is the server's rendered `SkipReason` (not a code), so it reads as
 * the sentence the gateway would put in `AllGated`'s diagnostics: `estimated 12000 input
 * tokens exceeds the model's 8192-token context window`, `router cooling down`, …
 */
export interface SkippedCandidate {
	model: string
	router: string
	reason: string
}

/** One candidate's place in the order selection handed the walk — server `RoutedCandidate`. */
export interface RoutedCandidate {
	/** `"{router}:{model}"`. */
	endpoint: string
	priority: number
	/** estimated cost; `null` for an unpriced (free) candidate. */
	cost: number | null
	/** windowed success rate; `null` means UNMEASURED, which is not the same as `0`. */
	reliability: number | null
	/** the draw weight, when the weighted default ran; `null` means it never entered a draw. */
	weight: number | null
}

/**
 * The measured order a call was given, when it was given one — mirrors the server
 * `RankingApplied`. `unmatched` is the interesting half in production: an artifact's roster
 * drifts from a deployment's availability, so a ref naming a model this deployment cannot
 * answer is recorded rather than rejected.
 */
export interface RankingApplied {
	/** the task category the order was measured for, e.g. `planner.select`. */
	category: string
	/** the artifact the rows came from, and its monotonic revision — recorded, never consulted. */
	source: { artifact: string; revision?: number; generated_at?: number } | null
	/** how many of the ranking's refs an admitted candidate answered. */
	matched: number
	/** refs no admitted candidate answered, in the ranking's own order. */
	unmatched: string[]
}

/** Why the candidates came out in this order — mirrors the server `RoutingDecision`. */
export interface RoutingDecisionRecord {
	/** the strategy that ACTUALLY ran (`grouped_weighted`, `price`, `latency`, …). */
	strategy: string
	/** a metric sort had too few samples to reorder anything, so it degraded to priority order. */
	degraded: boolean
	/**
	 * the candidates in the order the engine WOULD try them — after any `order` re-rank, and the
	 * whole list even when the walk stopped early. `attempts` is the record of what it did try.
	 */
	order: RoutedCandidate[]
	/** the measurement behind that order, when the caller supplied one. */
	ranking?: RankingApplied | null
}

/**
 * The per-call routing trace behind a request — the "why this model" explanation. Mirrors the
 * server `ExecutionTrace` (trace.rs), which the engine persists beside the call row it
 * describes (System One §9.6), so a run's calls carry one.
 *
 * The two halves of "why" are `routing` — the ORDER selection handed the walk, plus the
 * category and revision of the measurement it was obeyed under — and `skipped` — the models
 * that never got a chance, each with its gate's reason. `attempts` is what the walk actually
 * tried, which it can stop before the tail of `order` is reached.
 */
export interface RoutingTrace {
	request_id: string
	capability: string
	status: 'success' | 'failed'
	duration_ms: number
	/** every candidate selection admitted, before the walk. */
	candidates: TraceCandidate[]
	/** the withheld candidates and why — the "filtered-out models" half. */
	skipped: SkippedCandidate[]
	attempts: RoutingAttempt[]
	/** absent when no strategy ran at all (a direct router+model pin orders nothing). */
	routing?: RoutingDecisionRecord | null
	created_at: string
}

export interface BudgetNode {
	id: string
	parent_id: string | null
	kind: string
	name: string
	cap_amount: number | null
	spent_amount: number
	reserved_amount: number
	enforcement: string
	period: string
	/** alert fraction 0..1 (0.8 = alert at 80%); null = no alert set. */
	alert_threshold: number | null
	/** drop to a free local model when the cap is exhausted. */
	free_floor_enabled: boolean
}

export interface BudgetRequest {
	id: string
	node_id: string
	requested_by: string | null
	requested_cap: number
	reason: string | null
	status: string
	created_at: string
}

export interface Provider {
	name: string
	api_base_url: string
	is_active: boolean
	/** Does this router need a credential at all? Keyless local routers (ollama) don't. */
	requires_key: boolean
	/** Has THIS tenant sealed a BYOK key for the router? (No cross-tenant fallback.) */
	connected: boolean
	/** When the tenant's key was last set/rotated; null when not connected. */
	connected_at: string | null
	/** Has THIS tenant sealed an OAuth credential (bearer/setup-token) for the router? */
	oauth_connected: boolean
	/** When the tenant's OAuth credential was last set; null when not connected. */
	oauth_connected_at: string | null
}

export interface ApiKey {
	id: string
	prefix: string
	profile_id: string | null
	service_account_id: string | null
	scope: unknown
	status: string
	last_used_at: string | null
	created_at: string
}

/** The reveal-once mint result — `key` is the raw secret, shown exactly once. */
export interface IssuedKey {
	id: string
	prefix: string
	key: string
}

export interface Member {
	id: string
	display_name: string | null
	email: string | null
	roles: string[]
}

export interface Role {
	id: string
	key: string
	name: string
	is_system: boolean
	cap_count: number
	capabilities: string[]
}

export interface Capability {
	key: string
	domain: string
	description: string
}

export interface Feature {
	slug: string
	title: string
	description: string | null
	purpose: string | null
	enabled: boolean
	mandatory: boolean
	sequence: number
	/** workspace-scope policy override; null = unset (use the default posture). */
	policy_state: string | null
}

/** 4-state feature-governance posture (RW6). */
export type FeatureState = 'locked' | 'default-on' | 'default-off' | 'user-overridable'

export interface RoutingStep {
	id: string
	chain_name: string
	sequence_order: number
	plane: string
	router: string
	model: string
	is_active: boolean
	/** the chain's capability (`chat`, `decision`, `embedding`…) — what a step's models answer */
	capability: string
}

/** One row of a measured ranking as the tenant's chain would offer it (System One). */
export interface RankingRow {
	category: string
	chain_name: string
	/** the chain step's id — the same id /rpc/routing/set-step-active takes. */
	chain_model_id: string
	sequence_order: number
	model_full_name: string
	provider: string | null
	router_name: string | null
	plane: string
	context_window: number | null
	/** 1 = best; null unless the category's verdict is `winner` — a tie is a set, not an order. */
	rank: number | null
	verdict: string
	/** true/false only when there is an order to claim; null for a tie or unranked category. */
	within_margin: boolean | null
	/** greatest(configured margin, the category's top-model CI half-width). */
	effective_margin: number
	policy_revision: number | null
	accuracy: number | null
	ci_half_width: number | null
	/** is this chain model in the ranking at all (a measurement exists for it)? */
	measured: boolean
	/** set when the evidence is a stand-in for the category. */
	proxy: string | null
	/** the ranking row's own change counter. */
	revision: number | null
	artifact_sha: string | null
	corpus_sha: string | null
	generated_at: string | null
}

/** A category's ranking as a whole: verdict, margin in force, counts and provenance. */
export interface RankingCategory {
	category: string
	capability: string
	verdict: string
	effective_margin: number
	policy_revision: number | null
	chained: number
	measured: number
	admissible: number
	ranking_revision: number | null
	artifact_sha: string | null
	corpus_sha: string | null
	generated_at: string | null
	proxy: string | null
	/** why the resolver would (or would not) send an order — server-derived. */
	reason: string
	rows: RankingRow[]
}

/** One scope's margin for a category; `is_default` is the platform row. */
export interface RankingPolicy {
	category: string
	is_default: boolean
	margin: number
	revision: number
	modified_at: string
	modified_by: string
}

export interface RankingsData {
	capability: string
	categories: RankingCategory[]
	policies: RankingPolicy[]
}

export interface ModelRow {
	full_name: string
	display_name: string | null
	description: string | null
	context_window: number | null
	max_output_tokens: number | null
	released_on: string | null
	deprecated_on: string | null
	provider: string
	reachable: boolean
	enabled: boolean
	/** the chains that carry the model (enablement is derived from membership). */
	chains?: string[]
}

export interface McpServer {
	id: string
	name: string
	label: string | null
	transport: string // stdio | http | sse
	scope: string // platform | tenant
	enabled: boolean
}
export interface McpTool {
	id: string
	mcp_server_id: string
	tool_name: string
}
export interface ToolGrant {
	role_id: string
	mcp_server_id: string
	tool_name: string
}
export interface ToolsData {
	servers: McpServer[]
	tools: McpTool[]
	roles: { id: string; key: string; name: string }[]
	grants: ToolGrant[]
}

export interface Device {
	id: string
	name: string
	platform: string | null
	app_version: string | null
	config_version: number | null
	status: string // active | revoked
	owner: string | null
	enrolled_at: string | null
	last_seen_at: string | null
}

export const api = {
	// auth — Supabase password sign-in; the session persists to localStorage and every
	// gateway call reads its JWT via authHeader().
	signIn: async (email: string, password: string) => {
		const { error } = await sb().auth.signInWithPassword({ email, password })
		if (error) throw new Error(error.message)
	},
	// Passwordless magic link — also the register path: Supabase creates the user when
	// new, and the core.assign_tenant_by_domain trigger auto-joins them by email domain.
	// The emailed link lands back on /auth/callback (implicit flow → tokens in the URL,
	// parsed by detectSessionInUrl).
	signInWithMagicLink: async (email: string) => {
		const { error } = await sb().auth.signInWithOtp({
			email,
			options: {
				shouldCreateUser: true,
				emailRedirectTo: `${window.location.origin}/auth/callback`
			}
		})
		if (error) throw new Error(error.message)
	},
	// OAuth (GitHub v1). Convenience login; the same domain trigger applies on first
	// signup. Best-effort tenant match — a personal GitHub email falls into the no-org
	// path. Triggers a full-page redirect to the provider, then back to /auth/callback.
	signInWithOAuth: async (provider: 'github') => {
		const { error } = await sb().auth.signInWithOAuth({
			provider,
			options: { redirectTo: `${window.location.origin}/auth/callback` }
		})
		if (error) throw new Error(error.message)
	},
	signOut: async () => {
		const { error } = await sb().auth.signOut()
		// Clear the server cookie before the caller navigates away: the sign-out above is a hard nav,
		// which would cancel an in-flight mirror and leave a session the server still trusts.
		await postSession(null)
		if (error) throw new Error(error.message)
	},
	hasSession: async () => !!(await sb().auth.getSession()).data.session,
	// the signed-in user's shell identity — real email (from the session) + server-resolved
	// role (whoami). Replaces the mock "Aiko · Administrator" default in AppShell.
	identity: async (): Promise<{
		email: string | null
		role: string | null
		org: string | null
	}> => {
		const { data } = await sb().auth.getSession()
		const email = data.session?.user?.email ?? null
		let role: string | null = null
		let org: string | null = null
		try {
			const w = await gwGet<WhoAmI>('/v1/whoami')
			role = meaningfulRole(w.role)
			org = w.tenant_name ?? null
		} catch {
			/* advisory for the shell; email alone renders a real identity */
		}
		return { email, role, org }
	},
	whoami: () => gwGet<WhoAmI>('/v1/whoami'),
	audit: (limit = 100) => gwGet<{ events: AuditEvent[] }>(`/v1/audit?limit=${limit}`),
	requests: (limit = 100) => gwGet<{ requests: RequestRow[] }>(`/v1/requests?limit=${limit}`),
	// the per-call routing trace ("why this model") for one request — fetched on row select.
	requestTrace: (id: string) => gwGet<{ trace: RoutingTrace | null }>(`/v1/requests/${id}/trace`),
	// System One §9.2: one orchestrator run — its lifecycle, spend, charged unit, and every
	// call it made. The run id comes from a call's `run_id`; this is the join it buys.
	run: (id: string) => gwGet<RunResponse>(`/v1/runs/${encodeURIComponent(id)}`),
	// the page those rows come from — same header shape, one row per admitted run. `before` walks
	// back through the ledger with a keyset cursor (so runs admitted while an operator reads can
	// neither duplicate nor skip a row), `status` narrows to one lifecycle, and `failedOnly`
	// narrows to runs with a failed call — all three narrow the WHOLE ledger server-side, since a
	// filter applied to the page in hand would answer a different question than the one asked.
	// The failures flag is sent only when on: the gateway reads an absent flag as "every run", so
	// there is nothing for `false` to say.
	runs: (
		opts: { limit?: number; before?: RunCursor | null; status?: string; failedOnly?: boolean } = {}
	) => {
		const q = new URLSearchParams({ limit: String(opts.limit ?? 50) })
		if (opts.before) {
			q.set('before', opts.before.submitted_at)
			q.set('before_id', opts.before.run_id)
		}
		if (opts.status && opts.status !== 'all') q.set('status', opts.status)
		if (opts.failedOnly) q.set('failed_calls', 'true')
		return gwGet<RunsResponse>(`/v1/runs?${q}`)
	},
	budgets: () => gwGet<{ nodes: BudgetNode[]; requests: BudgetRequest[] }>('/v1/budgets'),
	connections: () => gwGet<{ providers: Provider[] }>('/v1/connections'),
	apikeys: () => gwGet<{ keys: ApiKey[] }>('/v1/apikeys'),
	org: () => gwGet<{ members: Member[]; roles: Role[]; capabilities: Capability[] }>('/v1/org'),
	models: () => gwGet<{ models: ModelRow[] }>('/v1/models'),
	routing: () => gwGet<{ steps: RoutingStep[] }>('/v1/routing'),
	// System One rankings — the measured store per category, with the rows this tenant's
	// chain would offer and the margin in force. Capability `model.manage`.
	rankings: (capability = 'decision') =>
		gwGet<RankingsData>(`/v1/rankings?capability=${encodeURIComponent(capability)}`),
	governance: () => gwGet<{ features: Feature[] }>('/v1/governance'),
	// O2 analytics — server-computed over the full ledger (+ savings baseline).
	analyticsOverview: () => gwGet<AnalyticsOverview>('/v1/analytics/overview'),
	planeSplit: (window = '30d') => gwGet<PlaneSplit>(`/v1/analytics/plane-split?window=${window}`),
	modelMix: (window = '14d') =>
		gwGet<{ models: ModelMixRow[] }>(`/v1/analytics/model-mix?window=${window}`),
	costTrend: (window = '14d') =>
		gwGet<CostTrend>(`/v1/analytics/cost-trend?window=${window}&bucket=day`),
	// writes — /rpc/* only:
	// Ask an admin to raise the cap on a budget node — records a PENDING budget_requests
	// row (capability `budget.request`); it changes no cap itself (approve does). The
	// gateway 404s if the node isn't in the caller's tenant. `requested_cap` is absolute.
	requestBudgetIncrease: (node_id: string, requested_cap: number, reason?: string) =>
		gwPost<{ id: string; status: string }>('/rpc/budgets/request', {
			node_id,
			requested_cap,
			reason
		}),
	approveBudgetRequest: (id: string) => gwPost('/rpc/budgets/approve-request', { id }),
	denyBudgetRequest: (id: string) => gwPost('/rpc/budgets/deny-request', { id }),
	upsertBudgetNode: (node: Record<string, unknown>) => gwPost('/rpc/budgets/upsert-node', node),

	// Delete a budget node + its whole subtree (server cascades via the parent_id self-FK).
	// The org root is undeletable (400) — resolution is fail-closed. Capability `budget.write`.
	deleteBudgetNode: (id: string) => gwPost<{ id: string }>('/rpc/budgets/delete-node', { id }),
	// mint an identity-bound API key — the raw secret is returned once, never re-fetchable.
	issueApiKey: (name?: string) => gwPost<IssuedKey>('/rpc/apikeys/issue', { name }),
	// revoke a key — it stops authenticating immediately (auth denies non-active status).
	revokeApiKey: (id: string) => gwPost('/rpc/apikeys/revoke', { id }),
	// F3 BYOK — seal a provider key into the tenant vault (write-only; never re-fetchable).
	// connect/rotate are the same server-side upsert; revoke deactivates it.
	connectConnection: (router: string, key: string, label?: string) =>
		gwPost('/rpc/connections/connect', { router, key, label }),
	rotateConnection: (router: string, key: string) =>
		gwPost('/rpc/connections/rotate', { router, key }),
	revokeConnection: (router: string) => gwPost('/rpc/connections/revoke', { router }),
	// F3 OAuth — seal a pasted OAuth bearer / setup-token (Anthropic v1, ToS-safe paste path).
	oauthConnectConnection: (router: string, token: string) =>
		gwPost('/rpc/connections/oauth-connect', { router, token }),
	oauthRevokeConnection: (router: string) => gwPost('/rpc/connections/oauth-revoke', { router }),
	// set a feature's governance posture (4-state) for a scope. Scope defaults to the
	// workspace default (scope_id null); pass a `role`/`space` scope to target it instead —
	// the gateway resolves precedence workspace → space → role → user server-side (C4 §4.2).
	setFeature: (feature_key: string, state: FeatureState, scope: FeatureScope = WORKSPACE_SCOPE) =>
		gwPost('/rpc/governance/set-feature', setFeaturePayload(feature_key, state, scope)),
	// enable/disable a fallback-chain step (the gateway skips inactive steps).
	setRoutingStep: (id: string, is_active: boolean) =>
		gwPost('/rpc/routing/set-step-active', { id, is_active }),
	// set this tenant's quality margin for one ranking category (accuracy points, 0..1).
	// The server bumps the policy revision + the tenant's routing snapshot; the ranks
	// themselves stay measurements and are not editable here.
	setRankingMargin: (category: string, margin: number) =>
		gwPost<{ ok: boolean; category: string; margin: number; revision: number }>(
			'/rpc/rankings/set-margin',
			{ category, margin }
		),
	// (§D Phase 3) Model enablement is derived from chain membership — no per-model toggle.
	// The Models screen shows `enabled` read-only (from /v1/models); manage it by editing chains.
	// assign a role to a member (bumps the target's claims_version — self-assign signs you out).
	assignRole: (profile_id: string, role_id: string) =>
		gwPost('/rpc/rbac/assign-role', { profile_id, role_id }),
	// remove a role from a member. Server-guarded: anti-escalation subset + a last-owner
	// guard (can't orphan the tenant). Bumps the target's claims_version.
	unassignRole: (profile_id: string, role_id: string) =>
		gwPost('/rpc/rbac/unassign-role', { profile_id, role_id }),
	// create a tenant-custom role (the "duplicate a default to customize" flow). Server-guarded:
	// no-shadowing (409 on a reserved default key or existing custom key) + anti-escalation
	// (403 if a requested capability exceeds your own).
	createRole: (key: string, name: string, capabilities: string[]) =>
		gwPost('/rpc/rbac/create-role', { key, name, capabilities }),
	// Self-service org creation (tenant-less caller). Returns the new tenant id. Caller must
	// refreshSession() afterwards so the JWT carries the new tenant_id/role_ids.
	createOrg: (name: string) => gwPost<{ tenant_id: string }>('/rpc/orgs/create', { name }),
	// Owner-only: hand ownership to another member.
	transferOwnership: (profileId: string) =>
		gwPost('/rpc/orgs/transfer-ownership', { profile_id: profileId }),
	// Force a new access token so freshly-changed claims (tenant_id/role_ids/claims_version)
	// take effect without a full sign-out.
	refreshSession: async () => {
		const { error } = await sb().auth.refreshSession()
		if (error) throw new Error(error.message)
	},
	// workspace-default policy toggles.
	settings: () => gwGet<{ settings: { setting_key: string; enabled: boolean }[] }>('/v1/settings'),
	setSetting: (setting_key: string, enabled: boolean) =>
		gwPost('/rpc/settings/set', { setting_key, enabled }),
	// X1 Tools & MCP — servers + tools + roles + role-default allow-list grants.
	tools: () => gwGet<ToolsData>('/v1/tools'),
	setMcpEnabled: (mcp_server_id: string, enabled: boolean) =>
		gwPost('/rpc/mcp/set-enabled', { mcp_server_id, enabled }),
	// grant/revoke a role-default tool grant (default-deny: absent = blocked).
	setToolGrant: (role_id: string, mcp_server_id: string, tool_name: string, allowed: boolean) =>
		gwPost('/rpc/mcp/set-tool-grant', { role_id, mcp_server_id, tool_name, allowed }),
	// O3 devices — enrolled desktop fleet. Revoke cuts the device on the auth hot path:
	// a revoked device with a still-live JWT is denied per-request (can't keep spending).
	devices: () => gwGet<{ devices: Device[] }>('/v1/devices'),
	revokeDevice: (id: string) => gwPost('/rpc/devices/revoke', { id })
}
