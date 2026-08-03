// Torii desktop — typed gateway reads for the member console. The desktop forwards the
// Kavach/Supabase session JWT; provider keys + enforcement stay server-side on C1.
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import { GATEWAY_URL } from './env'
import { session } from '@torii/core'
import { IS_E2E } from './e2e'

// A 401 means the token is stale (expired, or its claims_version was bumped by a role
// change / device revoke). Clear the dead session and bounce to sign-in once.
let redirecting = false
async function onUnauthorized(): Promise<void> {
	// E2E: the seeded session carries no real access token, so gateway reads 401 — but that
	// must NOT sign the test session out or bounce it to /signin (it would never reach the app).
	if (IS_E2E) return
	if (
		redirecting ||
		(typeof window !== 'undefined' && window.location.pathname.endsWith('/signin'))
	)
		return
	redirecting = true
	try {
		await session.signOut()
	} catch {
		/* already gone */
	}
	await goto(resolve('/signin'))
	redirecting = false // re-arm: a future session can hit 401 and redirect again
}

export async function gwGet<T>(path: string): Promise<T> {
	const token = session.accessToken
	const res = await fetch(`${GATEWAY_URL}${path}`, {
		headers: token ? { authorization: `Bearer ${token}` } : {}
	})
	if (res.status === 401) {
		await onUnauthorized()
		throw new Error('session expired — signing you in again')
	}
	if (!res.ok) throw new Error(`${path} → ${res.status}`)
	return res.json() as Promise<T>
}

// Gateway-mediated soft-delete (capability-checked server-side). The C5 doc-delete returns JSON.
export async function gwDelete<T>(path: string): Promise<T> {
	const token = session.accessToken
	const res = await fetch(`${GATEWAY_URL}${path}`, {
		method: 'DELETE',
		headers: token ? { authorization: `Bearer ${token}` } : {}
	})
	if (res.status === 401) {
		await onUnauthorized()
		throw new Error('session expired — signing you in again')
	}
	if (!res.ok) throw new Error(`${path} → ${res.status}`)
	return res.json() as Promise<T>
}

// Privileged writes go through C1 `/rpc/*` ONLY (never a direct PostgREST write). The gateway
// re-checks the capability + tenant isolation server-side — UI gating is advisory (spec §5).
export async function gwPost<T>(path: string, body: unknown): Promise<T> {
	const token = session.accessToken
	const res = await fetch(`${GATEWAY_URL}${path}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify(body)
	})
	if (res.status === 401) {
		await onUnauthorized()
		throw new Error('session expired — signing you in again')
	}
	if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text().catch(() => '')}`)
	return res.json() as Promise<T>
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
	/** which position in the fallback chain answered (1 = primary, >1 = fell back). */
	fallback_sequence: number
	recorded_at: string
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

/**
 * The per-call routing trace behind a request — the "why this model" chain. Mirrors the
 * server `ExecutionTrace` (trace.rs); `candidates`/`skipped` are empty from the chat path
 * today, so only `attempts` is surfaced.
 */
export interface RoutingTrace {
	request_id: string
	capability: string
	status: 'success' | 'failed'
	duration_ms: number
	attempts: RoutingAttempt[]
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
}

/** A member's pending/approved/denied budget-increase request (from `budget_requests`). */
export interface BudgetRequest {
	id: string
	node_id: string
	requested_by: string | null
	/** the absolute new ceiling the member asked an admin for. */
	requested_cap: number
	reason: string | null
	status: string
	created_at: string
}

export interface WhoAmI {
	sub: string
	tenant_id: string | null
	/** the tenant's display name (from core.tenants); null if the gateway predates it */
	tenant_name?: string | null
	role: string | null
	capabilities: string[]
}

/** A chat model this member may call through the gateway (enabled + reachable). */
export interface AvailableModel {
	full_name: string
	display_name: string
	provider: string
}

// O2 analytics (member-scoped): the plane-split rollup over the FULL ledger + the
// cloud-equivalent savings baseline the client can't derive from the capped /v1/requests
// read. Scope authz (A7) confines a non-admin member to their own subtree automatically.
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

export const api = {
	requests: (limit = 50) => gwGet<{ requests: RequestRow[] }>(`/v1/requests?limit=${limit}`),
	// O2 · local-vs-cloud split + savings for the caller's scope (A7 confines a member).
	planeSplit: (window = '30d') => gwGet<PlaneSplit>(`/v1/analytics/plane-split?window=${window}`),
	// the per-call routing trace ("why this model") for one request — lazy, on row expand.
	requestTrace: (id: string) => gwGet<{ trace: RoutingTrace | null }>(`/v1/requests/${id}/trace`),
	// the member's budget ceiling + cascade tree and their own pending increase requests.
	budgets: () => gwGet<{ nodes: BudgetNode[]; requests: BudgetRequest[] }>('/v1/budgets'),
	whoami: () => gwGet<WhoAmI>('/v1/whoami'),
	// the cloud chat models the member is allowed to call — powers Compare's cloud columns.
	availableModels: () => gwGet<{ models: AvailableModel[] }>('/v1/models/available'),
	// Ask an admin to raise the cap on a budget node — records a PENDING budget_requests row
	// (capability `budget.request`); it changes no cap itself (an admin approve does). The
	// gateway 404s if the node isn't in the caller's tenant. `requested_cap` is absolute.
	requestBudgetIncrease: (node_id: string, requested_cap: number, reason?: string) =>
		gwPost<{ id: string; status: string }>('/rpc/budgets/request', {
			node_id,
			requested_cap,
			reason
		})
}
