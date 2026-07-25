// W1 · AP0 — the single typed data-access layer for the admin portal.
//
// The admin is a CLIENT, not a trust boundary. Every call carries the browser
// Supabase session's RS256 JWT as `Authorization: Bearer`, and:
//   - READS go to capability-gated C1 GETs (`/v1/whoami`, `/v1/audit`, `/v1/requests`),
//   - WRITES go to C1 `/rpc/*` ONLY (never a direct PostgREST write to a privileged
//     table) — the gateway enforces capability + tenant isolation server-side.
// UX gating uses `whoami().capabilities` (advisory); the server is the only gate.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { GATEWAY_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './env'

// A browser Supabase client purely to read the persisted session's access token —
// Kavach signs in via Supabase under the hood, so `getSession()` returns the live JWT.
let _sb: SupabaseClient | null = null
function sb(): SupabaseClient {
	if (!_sb) {
		_sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: { persistSession: true, autoRefreshToken: true }
		})
	}
	return _sb
}

async function authHeader(): Promise<Record<string, string>> {
	const { data } = await sb().auth.getSession()
	const token = data.session?.access_token
	return token ? { authorization: `Bearer ${token}` } : {}
}

async function gwGet<T>(path: string): Promise<T> {
	const res = await fetch(`${GATEWAY_URL}${path}`, { headers: await authHeader() })
	if (!res.ok) throw new Error(`${path} → ${res.status}`)
	return res.json() as Promise<T>
}

async function gwPost<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${GATEWAY_URL}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(await authHeader()) },
		body: JSON.stringify(body)
	})
	if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text().catch(() => '')}`)
	return res.json() as Promise<T>
}

export interface WhoAmI {
	sub: string
	tenant_id: string | null
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
	execution_location: string | null
	input_tokens: number | null
	output_tokens: number | null
	cost_usd: number
	duration_ms: number
	status: string
	recorded_at: string
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
	configured: boolean
	is_active: boolean
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
}

export interface RoutingStep {
	chain_name: string
	sequence_order: number
	plane: string
	router: string
	model: string
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
}

export const api = {
	// auth — Supabase password sign-in; the session persists to localStorage and every
	// gateway call reads its JWT via authHeader().
	signIn: async (email: string, password: string) => {
		const { error } = await sb().auth.signInWithPassword({ email, password })
		if (error) throw new Error(error.message)
	},
	signOut: () => sb().auth.signOut(),
	hasSession: async () => !!(await sb().auth.getSession()).data.session,
	whoami: () => gwGet<WhoAmI>('/v1/whoami'),
	audit: (limit = 100) => gwGet<{ events: AuditEvent[] }>(`/v1/audit?limit=${limit}`),
	requests: (limit = 100) => gwGet<{ requests: RequestRow[] }>(`/v1/requests?limit=${limit}`),
	budgets: () => gwGet<{ nodes: BudgetNode[]; requests: BudgetRequest[] }>('/v1/budgets'),
	connections: () => gwGet<{ providers: Provider[] }>('/v1/connections'),
	apikeys: () => gwGet<{ keys: ApiKey[] }>('/v1/apikeys'),
	org: () => gwGet<{ members: Member[]; roles: Role[]; capabilities: Capability[] }>('/v1/org'),
	models: () => gwGet<{ models: ModelRow[] }>('/v1/models'),
	routing: () => gwGet<{ steps: RoutingStep[] }>('/v1/routing'),
	governance: () => gwGet<{ features: Feature[] }>('/v1/governance'),
	// writes — /rpc/* only:
	approveBudgetRequest: (id: string) => gwPost('/rpc/budgets/approve-request', { id }),
	denyBudgetRequest: (id: string) => gwPost('/rpc/budgets/deny-request', { id }),
	upsertBudgetNode: (node: Record<string, unknown>) => gwPost('/rpc/budgets/upsert-node', node),
	// mint an identity-bound API key — the raw secret is returned once, never re-fetchable.
	issueApiKey: (name?: string) => gwPost<IssuedKey>('/rpc/apikeys/issue', { name })
}
