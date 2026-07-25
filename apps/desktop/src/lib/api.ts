// Torii desktop — typed gateway reads for the member console. The desktop forwards the
// Kavach/Supabase session JWT; provider keys + enforcement stay server-side on C1.
import { GATEWAY_URL } from './env'
import { session } from '@torii/core'

async function gwGet<T>(path: string): Promise<T> {
	const token = session.accessToken
	const res = await fetch(`${GATEWAY_URL}${path}`, {
		headers: token ? { authorization: `Bearer ${token}` } : {}
	})
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

export const api = {
	requests: (limit = 50) => gwGet<{ requests: RequestRow[] }>(`/v1/requests?limit=${limit}`),
	budgets: () => gwGet<{ nodes: BudgetNode[]; requests: unknown[] }>('/v1/budgets')
}
