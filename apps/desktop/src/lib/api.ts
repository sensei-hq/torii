// Torii desktop — typed gateway reads for the member console. The desktop forwards the
// Kavach/Supabase session JWT; provider keys + enforcement stay server-side on C1.
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import { GATEWAY_URL } from './env'
import { session } from '@torii/core'

// A 401 means the token is stale (expired, or its claims_version was bumped by a role
// change / device revoke). Clear the dead session and bounce to sign-in once.
let redirecting = false
async function onUnauthorized(): Promise<void> {
	// E2E: the seeded session carries no real access token, so gateway reads 401 — but that
	// must NOT sign the test session out or bounce it to /signin (it would never reach the app).
	if (import.meta.env.VITE_E2E === 'true') return
	if (redirecting || (typeof window !== 'undefined' && window.location.pathname.endsWith('/signin')))
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

async function gwGet<T>(path: string): Promise<T> {
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

export const api = {
	requests: (limit = 50) => gwGet<{ requests: RequestRow[] }>(`/v1/requests?limit=${limit}`),
	budgets: () => gwGet<{ nodes: BudgetNode[]; requests: unknown[] }>('/v1/budgets'),
	whoami: () => gwGet<WhoAmI>('/v1/whoami'),
	// the cloud chat models the member is allowed to call — powers Compare's cloud columns.
	availableModels: () => gwGet<{ models: AvailableModel[] }>('/v1/models/available')
}
